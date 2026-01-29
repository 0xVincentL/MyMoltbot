import Parser from 'rss-parser';
import path from 'node:path';
import { readJson, writeJson, sha256, utcNowIso, parseDateMaybe, toMdItem } from './lib.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { lookbackHours: 24, limit: 10 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--lookback-hours') out.lookbackHours = Number(args[++i]);
    else if (a === '--limit') out.limit = Number(args[++i]);
  }
  return out;
}

const ROOT = new URL('..', import.meta.url).pathname;
const cfgPath = path.join(ROOT, 'feeds.json');
const storePath = path.join(ROOT, 'data', 'store.json');

const cfg = await readJson(cfgPath, null);
if (!cfg) {
  console.error('missing feeds.json');
  process.exit(1);
}

// --- update step (fetch & dedupe) ---
const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'us-news/0.1 (+https://github.com/0xVincentL/MyMoltbot)'
  }
});

const store = await readJson(storePath, { items: {}, lastRunAt: null });
const warnings = [];
let newCount = 0;

for (const f of cfg.feeds) {
  try {
    const feed = await parser.parseURL(f.url);
    const items = feed.items || [];

    for (const it of items) {
      const title = it.title || '';
      const link = it.link || it.guid || '';
      const pub = parseDateMaybe(it.isoDate || it.pubDate || it.published);
      const iso = pub ? pub.toISOString() : null;

      const id = sha256(`${f.name}|${link}|${title}`);
      if (store.items[id]) continue;

      store.items[id] = {
        id,
        feedName: f.name,
        title,
        link,
        iso,
        tags: f.tags || [],
        fetchedAt: utcNowIso()
      };
      newCount += 1;
    }
  } catch (e) {
    warnings.push(`[warn] ${f.name} -> ${e?.message || e}`);
  }
}

store.lastRunAt = utcNowIso();
await writeJson(storePath, store);

// --- digest step ---
const { lookbackHours, limit } = parseArgs();
const hours = Number.isFinite(lookbackHours) && lookbackHours > 0 ? lookbackHours : (cfg?.defaultLookbackHours || 24);
const since = Date.now() - hours * 3600 * 1000;

let items = Object.values(store.items || {});
items = items.filter(it => {
  const t = it.iso ? Date.parse(it.iso) : Date.parse(it.fetchedAt);
  return Number.isFinite(t) && t >= since;
});
items.sort((a, b) => (Date.parse(b.iso || b.fetchedAt) - Date.parse(a.iso || a.fetchedAt)));

const top = items.slice(0, limit);

const lines = [];
lines.push(`# 市场要闻 Top ${limit}（最近 ${hours}h · UTC）`);
lines.push('');
lines.push(`更新：${store.lastRunAt} · 新增条目：${newCount}`);

// If the agent / Codespace was down, cron jobs won't run. We can't notify *during* downtime,
// but we can flag the next time we are alive.
if (store.lastRunAt) {
  const last = Date.parse(store.lastRunAt);
  if (Number.isFinite(last)) {
    const deltaH = (Date.now() - last) / 3600e3;
    if (deltaH > 30) {
      lines.push(`⚠️ 检测到上次成功运行距今约 ${deltaH.toFixed(1)} 小时：期间可能因服务/页面不在线而错过定时推送。`);
    }
  }
}

lines.push('');

if (!top.length) {
  lines.push('（该时间窗内暂无抓取到的条目）');
} else {
  for (const it of top) lines.push(toMdItem(it));
}

if (warnings.length) {
  lines.push('');
  lines.push('---');
  lines.push('抓取告警（部分站点可能反爬/限流）：');
  for (const w of warnings.slice(0, 8)) lines.push(`- ${w}`);
}

process.stdout.write(lines.join('\n') + '\n');
