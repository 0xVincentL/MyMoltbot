import { readJson, toMdItem } from './lib.js';
import path from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { lookbackHours: null, limit: 40, tags: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--lookback-hours') out.lookbackHours = Number(args[++i]);
    else if (a === '--limit') out.limit = Number(args[++i]);
    else if (a === '--tags') out.tags = String(args[++i]).split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}

const ROOT = new URL('..', import.meta.url).pathname;
const cfgPath = path.join(ROOT, 'feeds.json');
const storePath = path.join(ROOT, 'data', 'store.json');

const cfg = await readJson(cfgPath, null);
const store = await readJson(storePath, { items: {}, lastRunAt: null });

const { lookbackHours, limit, tags } = parseArgs();
const hours = Number.isFinite(lookbackHours) && lookbackHours > 0 ? lookbackHours : (cfg?.defaultLookbackHours || 24);

const since = Date.now() - hours * 3600 * 1000;

let items = Object.values(store.items || {});
items = items.filter(it => {
  const t = it.iso ? Date.parse(it.iso) : Date.parse(it.fetchedAt);
  return Number.isFinite(t) && t >= since;
});

if (tags && tags.length) {
  items = items.filter(it => (it.tags || []).some(t => tags.includes(t)));
}

items.sort((a, b) => {
  const ta = Date.parse(a.iso || a.fetchedAt);
  const tb = Date.parse(b.iso || b.fetchedAt);
  return tb - ta;
});

const header = `# 美国宏观 & 美股要闻（最近 ${hours}h · UTC）\n\n`;
if (!items.length) {
  process.stdout.write(header + '（该时间窗内暂无抓取到的条目；你可以先运行：npm run update）\n');
  process.exit(0);
}

const lines = [header];
for (const it of items.slice(0, limit)) {
  lines.push(toMdItem(it));
}

process.stdout.write(lines.join('\n') + '\n');
