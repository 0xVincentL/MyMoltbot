#!/usr/bin/env node
/**
 * Solana whale wallet monitor (MVP)
 * - Reads wallets from tools/smart-money/wallets.json
 * - Polls getSignaturesForAddress
 * - Fetches getTransaction (jsonParsed)
 * - Computes SOL balance delta for the watched wallet
 * - Logs events to memory/smart-money/solana-events.jsonl
 * - Updates checkpoints in memory/smart-money/solana-checkpoints.json
 * - Writes a last-24h summary to memory/smart-money/solana-summary.json
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const getArg = (k, def) => {
  const i = argv.indexOf(k);
  if (i === -1) return def;
  return argv[i + 1] ?? def;
};

const RPC_URLS = String(process.env.SOLANA_RPC_URLS || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
let rpcIdx = 0;
function pickRpcUrl() {
  const url = RPC_URLS[Math.min(rpcIdx, RPC_URLS.length - 1)] || RPC_URLS[0];
  rpcIdx = (rpcIdx + 1) % Math.max(1, RPC_URLS.length);
  return url;
}
const THRESHOLD_SOL = Number(getArg('--threshold-sol', '100'));
const LIMIT = Math.max(5, Math.min(200, Number(getArg('--limit', '40'))));

// NOTE: This script lives under MyMoltbot/, but the Clawdbot dashboard expects
// memory/ to be at the workspace root (/home/codespace/clawd). So we anchor ROOT
// three levels up from tools/smart-money/.
const ROOT = path.resolve(__dirname, '..', '..', '..');
const WALLETS_PATH = path.resolve(__dirname, 'wallets.json');

const MEM_DIR = path.join(ROOT, 'memory', 'smart-money');
const CHECKPOINTS_PATH = path.join(MEM_DIR, 'solana-checkpoints.json');
const EVENTS_PATH = path.join(MEM_DIR, 'solana-events.jsonl');
const SUMMARY_PATH = path.join(MEM_DIR, 'solana-summary.json');

function readJsonSafe(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function appendJsonl(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(obj) + '\n');
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function rpc(method, params, attempt = 0) {
  const url = pickRpcUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) {
    // Backoff on rate limit / transient gateway errors
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = Math.min(20_000, 400 * (2 ** attempt));
      await sleep(wait);
      return rpc(method, params, attempt + 1);
    }
    throw new Error(`RPC HTTP ${res.status}`);
  }
  const j = await res.json();
  if (j.error) throw new Error(`RPC error: ${JSON.stringify(j.error)}`);
  return j.result;
}

function lamportsToSol(l) {
  return Number(l) / 1e9;
}

function dayKeyUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

async function main() {
  const wallets = readJsonSafe(WALLETS_PATH, []);
  if (!Array.isArray(wallets) || wallets.length === 0) {
    console.error('No wallets configured. Edit tools/smart-money/wallets.json');
    process.exitCode = 2;
    return;
  }

  const checkpoints = readJsonSafe(CHECKPOINTS_PATH, {});
  const now = Date.now();

  let newEvents = 0;

  for (const w of wallets) {
    const address = w.address;
    if (!address) continue;

    const lastSig = checkpoints[address]?.lastSignature || null;

    const sigs = await rpc('getSignaturesForAddress', [
      address,
      { limit: LIMIT, ...(lastSig ? { until: lastSig } : {}) },
    ]);

    if (!Array.isArray(sigs) || sigs.length === 0) continue;

    // Process oldest -> newest
    const ordered = sigs.slice().reverse();

    for (const s of ordered) {
      const signature = s.signature;
      if (!signature) continue;

      const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      if (!tx || !tx.meta || !tx.transaction) continue;

      const keys = tx.transaction.message.accountKeys || [];
      const idx = keys.findIndex((k) => (k.pubkey || k) === address);
      if (idx < 0) continue;

      const pre = tx.meta.preBalances?.[idx];
      const post = tx.meta.postBalances?.[idx];
      if (typeof pre !== 'number' || typeof post !== 'number') continue;

      const deltaLamports = post - pre;
      const deltaSol = lamportsToSol(deltaLamports);
      if (Math.abs(deltaSol) < THRESHOLD_SOL) continue;

      const event = {
        chain: 'solana',
        kind: 'whale_sol_balance_change',
        signature,
        slot: tx.slot ?? null,
        blockTime: tx.blockTime ? tx.blockTime * 1000 : null,
        observedAt: now,
        wallet: { address, name: w.name || null },
        deltaSol,
        direction: deltaSol > 0 ? 'in' : 'out',
        thresholdSol: THRESHOLD_SOL,
        links: {
          solscan: `https://solscan.io/tx/${signature}`,
          explorer: `https://explorer.solana.com/tx/${signature}`,
        },
      };

      appendJsonl(EVENTS_PATH, event);
      newEvents++;
    }

    // update last processed signature to newest in this batch
    const newest = sigs[0]?.signature;
    if (newest) {
      checkpoints[address] = { lastSignature: newest, updatedAt: new Date().toISOString() };
    }
  }

  writeJson(CHECKPOINTS_PATH, checkpoints);

  // Build summary (last 24h)
  const sinceMs = now - 24 * 3600 * 1000;
  let lines = [];
  try {
    const raw = fs.readFileSync(EVENTS_PATH, 'utf8');
    lines = raw.split('\n').filter(Boolean);
  } catch {}

  const events = [];
  for (const line of lines.slice(-5000)) {
    try {
      const e = JSON.parse(line);
      const t = e.blockTime || e.observedAt || 0;
      if (t >= sinceMs) events.push(e);
    } catch {}
  }

  const byWallet = {};
  for (const e of events) {
    const k = e.wallet?.address || 'unknown';
    byWallet[k] = byWallet[k] || { address: k, name: e.wallet?.name || null, inSol: 0, outSol: 0, count: 0 };
    byWallet[k].count++;
    if (e.deltaSol > 0) byWallet[k].inSol += e.deltaSol;
    else byWallet[k].outSol += Math.abs(e.deltaSol);
  }

  const summary = {
    ok: true,
    asOf: new Date().toISOString(),
    lookbackHours: 24,
    thresholdSol: THRESHOLD_SOL,
    rpc: RPC_URLS,
    eventCount24h: events.length,
    wallets: Object.values(byWallet).sort((a, b) => (b.inSol + b.outSol) - (a.inSol + a.outSol)).slice(0, 50),
    latest: events.sort((a, b) => (b.blockTime || b.observedAt || 0) - (a.blockTime || a.observedAt || 0)).slice(0, 20),
  };

  writeJson(SUMMARY_PATH, summary);

  // Print minimal output for logs
  console.log(JSON.stringify({ ok: true, newEvents, summaryPath: SUMMARY_PATH }));
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exitCode = 1;
});
