#!/usr/bin/env python3
"""Check blogwatcher unread articles for Hong Kong flight/hotel deals.

Workflow:
1) blogwatcher scan
2) blogwatcher articles (unread)
3) filter by keywords
4) print a compact alert message
5) mark matching article ids as read (unless --no-mark-read)

Designed to be called from HEARTBEAT.md.
"""

from __future__ import annotations

import argparse
import re
import subprocess
from dataclasses import dataclass
from typing import List, Optional


BLOGS_TO_SCAN_DEFAULT = [
    "The Flight Deal",
    "Travel-Dealz",
    "One Mile at a Time",
]

KEYWORDS_DEFAULT = [
    # destination
    r"hong\s*kong",
    r"\bhkg\b",
    r"\bhk\b",
    r"香港",
    r"\bkowloon\b",
    r"\btsim\s*sha\s*tsui\b",
    # nearby / route keywords
    r"macau",
    r"\bmfm\b",
    r"澳门",
    r"guangzhou",
    r"\bcan\b",
    r"广州",
    # origin
    r"chengdu",
    r"\bctu\b",
    r"成都",
]


@dataclass
class Article:
    id: int
    title: str
    blog: Optional[str]
    url: Optional[str]
    published: Optional[str]


ARTICLE_HEADER_RE = re.compile(r"^\s*\[(\d+)\]\s*\[new\]\s*(.*)$")


def run(cmd: List[str], timeout_s: int = 45) -> str:
    p = subprocess.run(
        cmd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout_s,
    )
    if p.returncode != 0:
        raise subprocess.CalledProcessError(p.returncode, cmd, output=p.stdout)
    return p.stdout


def parse_articles(text: str) -> List[Article]:
    lines = text.splitlines()
    out: List[Article] = []

    cur: Optional[Article] = None

    for line in lines:
        m = ARTICLE_HEADER_RE.match(line)
        if m:
            if cur:
                out.append(cur)
            cur = Article(
                id=int(m.group(1)),
                title=m.group(2).strip(),
                blog=None,
                url=None,
                published=None,
            )
            continue

        if not cur:
            continue

        s = line.strip()
        if s.startswith("Blog:"):
            cur.blog = s.replace("Blog:", "", 1).strip()
        elif s.startswith("URL:"):
            cur.url = s.replace("URL:", "", 1).strip()
        elif s.startswith("Published:"):
            cur.published = s.replace("Published:", "", 1).strip()

    if cur:
        out.append(cur)

    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--keywords",
        action="append",
        default=[],
        help="Add a regex keyword (repeatable).",
    )
    ap.add_argument(
        "--no-mark-read",
        action="store_true",
        help="Do not mark matched articles as read.",
    )
    ap.add_argument(
        "--max",
        type=int,
        default=10,
        help="Max number of matched items to include in the alert.",
    )
    args = ap.parse_args()

    patterns = [re.compile(p, re.I) for p in (KEYWORDS_DEFAULT + args.keywords)]

    # 1) scan (only selected sources; some feeds block bots and can hang)
    for blog in BLOGS_TO_SCAN_DEFAULT:
        try:
            run(["blogwatcher", "scan", blog], timeout_s=25)
        except subprocess.TimeoutExpired:
            print(f"HK-DEALS: scan timeout for blog: {blog}")
        except subprocess.CalledProcessError as e:
            print(f"HK-DEALS: scan failed for blog: {blog}\n" + (e.output or ""))

    # 2) unread articles
    try:
        out = run(["blogwatcher", "articles"], timeout_s=30)
    except subprocess.CalledProcessError as e:
        print("HK-DEALS: blogwatcher articles failed:\n" + e.output)
        return 2

    articles = parse_articles(out)
    if not articles:
        return 0

    matched: List[Article] = []
    for a in articles:
        hay = f"{a.title}\n{a.blog or ''}\n{a.url or ''}"
        if any(p.search(hay) for p in patterns):
            matched.append(a)

    if not matched:
        return 0

    matched = matched[: args.max]

    print("香港机票/酒店情报：发现可能相关的新优惠/文章（来自监控源）")
    for a in matched:
        meta = []
        if a.blog:
            meta.append(a.blog)
        if a.published:
            meta.append(a.published)
        meta_s = " · ".join(meta)
        if meta_s:
            print(f"- {a.title}（{meta_s}）")
        else:
            print(f"- {a.title}")
        if a.url:
            print(f"  {a.url}")

    if not args.no_mark_read:
        for a in matched:
            try:
                run(["blogwatcher", "read", str(a.id)])
            except subprocess.CalledProcessError:
                # best-effort; avoid blocking alerts
                pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
