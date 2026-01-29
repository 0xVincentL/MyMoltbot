import Parser from 'rss-parser';
import { readJson, writeJson, sha256, utcNowIso, parseDateMaybe } from './lib.js';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const cfgPath = path.join(ROOT, 'feeds.json');
const storePath = path.join(ROOT, 'data', 'store.json');

const cfg = await readJson(cfgPath, null);
if (!cfg) {
  console.error('missing feeds.json');
  process.exit(1);
}

const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'us-news/0.1 (+https://github.com/0xVincentL/MyMoltbot)'
  }
});

const store = await readJson(storePath, { items: {}, lastRunAt: null });
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
    console.error(`[warn] failed: ${f.name} ${f.url} -> ${e?.message || e}`);
  }
}

store.lastRunAt = utcNowIso();
await writeJson(storePath, store);

console.log(`ok: newItems=${newCount}`);
