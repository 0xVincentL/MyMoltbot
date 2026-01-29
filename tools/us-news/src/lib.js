import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export function utcNowIso() {
  return new Date().toISOString();
}

export function parseDateMaybe(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function readJson(filePath, fallback) {
  try {
    const s = await fs.readFile(filePath, 'utf8');
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export function toMdItem({ feedName, title, link, iso, tags }) {
  const t = (title || '(no title)').replace(/\s+/g, ' ').trim();
  const when = iso ? ` · ${iso}` : '';
  const tagStr = (tags && tags.length) ? ` _(${tags.join(', ')})_` : '';
  return `- **${feedName}**${when}${tagStr}\n  - ${t}\n  - ${link}`;
}
