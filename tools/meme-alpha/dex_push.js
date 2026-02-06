#!/usr/bin/env node
/**
 * Dexscreener-only Solana meme alpha scanner.
 *
 * Outputs either human-readable text (default) or JSON lines (--emit-json).
 * Does NOT send messages itself (so we can use OpenClaw message tool from cron).
 */

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const FLAG = new Set(argv);
const getArg = (k, def) => {
  const i = argv.indexOf(k);
  if (i === -1) return def;
  return argv[i + 1] ?? def;
};

const DRY_RUN = FLAG.has('--dry-run');
const EMIT_JSON = FLAG.has('--emit-json');
const CHAIN_ID = 'solana';

const LIMIT_TOKENS = Number(getArg('--limit', '60'));
const COOLDOWN_MIN = Number(getArg('--cooldown-min', '30'));

// Thresholds (tuneable)
const MIN_LIQ_USD = Number(getArg('--min-liq', '30000'));
const MIN_VOL_M5 = Number(getArg('--min-vol-m5', '5000'));
const MIN_VOL_H1 = Number(getArg('--min-vol-h1', '30000'));
const MIN_TXNS_M5 = Number(getArg('--min-txns-m5', '30'));
const MAX_FDV_L = Number(getArg('--max-fdv-liq', '200'));

const STATE_PATH = path.resolve('memory/dexscreener-alpha-state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {
      sentPairs: {}, // pairAddress -> lastSentMs
      lastRunMs: 0,
    };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'accept': 'application/json',
        'user-agent': 'openclaw-meme-alpha/1.0',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} for ${url} :: ${text.slice(0, 120)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function pickBestPair(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const solPairs = pairs.filter(p => p?.chainId === CHAIN_ID);
  if (solPairs.length === 0) return null;
  // Choose by highest liquidity USD, then volume h1
  solPairs.sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0) || (b?.volume?.h1 ?? 0) - (a?.volume?.h1 ?? 0));
  return solPairs[0];
}

function scorePair(p, boosted) {
  const liq = Number(p?.liquidity?.usd ?? 0);
  const vol5 = Number(p?.volume?.m5 ?? 0);
  const vol1 = Number(p?.volume?.h1 ?? 0);
  const tx5 = Number((p?.txns?.m5?.buys ?? 0) + (p?.txns?.m5?.sells ?? 0));
  const fdv = Number(p?.fdv ?? 0);
  const fdvL = liq > 0 ? fdv / liq : Infinity;

  const reasons = [];
  let pass = true;

  if (liq < MIN_LIQ_USD) { pass = false; reasons.push(`liq<$${MIN_LIQ_USD}`); }
  if (vol5 < MIN_VOL_M5) { pass = false; reasons.push(`vol5<$${MIN_VOL_M5}`); }
  if (vol1 < MIN_VOL_H1) { pass = false; reasons.push(`vol1<$${MIN_VOL_H1}`); }
  if (tx5 < MIN_TXNS_M5) { pass = false; reasons.push(`tx5<${MIN_TXNS_M5}`); }

  // fdv/liquidity: not an absolute veto (can be tiny fdv early), but penalize heavily.
  if (Number.isFinite(fdvL) && fdvL > MAX_FDV_L) {
    reasons.push(`fdv/liq>${MAX_FDV_L.toFixed(0)}`);
  }
  if (boosted) reasons.push('boosted');

  // score (0-100) heuristic
  const sL = Math.min(40, (liq / MIN_LIQ_USD) * 20);
  const sV = Math.min(35, (vol1 / MIN_VOL_H1) * 20 + (vol5 / MIN_VOL_M5) * 10);
  const sT = Math.min(20, (tx5 / MIN_TXNS_M5) * 10);
  let score = sL + sV + sT;

  if (Number.isFinite(fdvL) && fdvL > MAX_FDV_L) score -= 15;
  if (boosted) score -= 5; // marketing != validation
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { pass, score, reasons, metrics: { liq, vol5, vol1, tx5, fdv, fdvL } };
}

function fmtMoney(x, digits = 0) {
  if (!Number.isFinite(x)) return '-';
  const abs = Math.abs(x);
  if (abs >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(x / 1e3).toFixed(2)}K`;
  return `$${x.toFixed(digits)}`;
}

function buildAlert(p, scored) {
  const base = p?.baseToken ?? {};
  const sym = base.symbol ?? '???';
  const name = base.name ?? '';
  const token = base.address;
  const url = p?.url;
  const m = scored.metrics;

  const lines = [];
  lines.push(`Meme alpha (Dexscreener) 评分 ${scored.score}/100`);
  lines.push(`${sym}${name ? ` (${name})` : ''}`);
  lines.push(url);
  lines.push(`liq ${fmtMoney(m.liq)} | vol5 ${fmtMoney(m.vol5)} | vol1 ${fmtMoney(m.vol1)} | tx5 ${m.tx5}`);
  if (Number.isFinite(m.fdvL) && m.fdvL !== Infinity) lines.push(`FDV ${fmtMoney(m.fdv)} | FDV/L ${m.fdvL.toFixed(1)}`);
  if (scored.reasons.length) lines.push(`flags: ${scored.reasons.join(', ')}`);
  lines.push(`token: ${token}`);
  return lines.join('\n');
}

async function main() {
  const state = loadState();
  const now = Date.now();
  const cooldownMs = COOLDOWN_MIN * 60_000;

  // Sources: latest token profiles + boosts top/latest
  const [latestProfiles, boostsTop, boostsLatest] = await Promise.all([
    fetchJson('https://api.dexscreener.com/token-profiles/latest/v1'),
    fetchJson('https://api.dexscreener.com/token-boosts/top/v1'),
    fetchJson('https://api.dexscreener.com/token-boosts/latest/v1'),
  ]);

  const boostedSet = new Set([
    ...(Array.isArray(boostsTop) ? boostsTop : []),
    ...(Array.isArray(boostsLatest) ? boostsLatest : []),
  ].filter(x => x?.chainId === CHAIN_ID).map(x => x.tokenAddress));

  const tokens = [];
  const seen = new Set();
  for (const src of [latestProfiles, boostsTop, boostsLatest]) {
    if (!Array.isArray(src)) continue;
    for (const row of src) {
      if (row?.chainId !== CHAIN_ID) continue;
      const t = row?.tokenAddress;
      if (!t || seen.has(t)) continue;
      seen.add(t);
      tokens.push(t);
      if (tokens.length >= LIMIT_TOKENS) break;
    }
    if (tokens.length >= LIMIT_TOKENS) break;
  }

  const alerts = [];

  // Fetch token pairs (bounded concurrency)
  const CONC = 6;
  let idx = 0;
  async function worker() {
    while (idx < tokens.length) {
      const t = tokens[idx++];
      try {
        const j = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${t}`);
        const best = pickBestPair(j?.pairs);
        if (!best) continue;

        const pairAddr = best.pairAddress;
        const lastSent = state.sentPairs[pairAddr] ?? 0;
        if (now - lastSent < cooldownMs) continue;

        const boosted = boostedSet.has(t);
        const scored = scorePair(best, boosted);

        // Trigger condition: hard pass + score threshold
        if (scored.pass && scored.score >= 60) {
          const alert = {
            kind: 'dexscreener_meme_alpha',
            whenMs: now,
            chainId: CHAIN_ID,
            tokenAddress: t,
            pairAddress: pairAddr,
            url: best.url,
            symbol: best?.baseToken?.symbol,
            name: best?.baseToken?.name,
            score: scored.score,
            reasons: scored.reasons,
            metrics: scored.metrics,
            text: buildAlert(best, scored),
          };
          alerts.push(alert);
          state.sentPairs[pairAddr] = now;
        }
      } catch (e) {
        // ignore individual token failures
      }
    }
  }

  await Promise.all(Array.from({ length: CONC }, () => worker()));

  // Sort & dedupe output so Telegram/Web see best candidates first.
  // (Concurrency makes discovery order nondeterministic.)
  const uniq = new Map();
  for (const a of alerts) {
    const k = a.pairAddress || a.tokenAddress;
    if (!k) continue;
    // keep the better one if duplicated
    const prev = uniq.get(k);
    if (!prev) {
      uniq.set(k, a);
      continue;
    }
    const prevScore = Number(prev.score ?? 0);
    const curScore = Number(a.score ?? 0);
    if (curScore > prevScore) uniq.set(k, a);
  }

  const sorted = Array.from(uniq.values()).sort((a, b) => {
    const as = Number(a.score ?? 0);
    const bs = Number(b.score ?? 0);
    if (bs !== as) return bs - as;
    const av1 = Number(a.metrics?.vol1 ?? 0);
    const bv1 = Number(b.metrics?.vol1 ?? 0);
    if (bv1 !== av1) return bv1 - av1;
    const aliq = Number(a.metrics?.liq ?? 0);
    const bliq = Number(b.metrics?.liq ?? 0);
    if (bliq !== aliq) return bliq - aliq;
    const atx = Number(a.metrics?.tx5 ?? 0);
    const btx = Number(b.metrics?.tx5 ?? 0);
    return btx - atx;
  });

  state.lastRunMs = now;
  if (!DRY_RUN) saveState(state);

  if (EMIT_JSON) {
    for (const a of sorted) process.stdout.write(JSON.stringify(a) + '\n');
  } else {
    if (sorted.length === 0) return;
    for (const a of sorted) {
      process.stdout.write(a.text + '\n\n');
    }
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exitCode = 1;
});
