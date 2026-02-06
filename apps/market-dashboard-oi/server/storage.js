const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

function saveHistory(rows) {
  ensureDir();
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(rows, null, 2));
}

function dayKeyShanghai(ts = new Date()) {
  // Asia/Shanghai is UTC+8 (no DST)
  const d = new Date(ts.getTime() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function upsertDailySnapshot(snapshot) {
  const rows = loadHistory();
  const key = dayKeyShanghai(new Date(snapshot.asOf));

  const row = {
    day: key,
    asOf: snapshot.asOf,
    // prices
    btc: snapshot.prices?.BTC?.usd ?? null,
    eth: snapshot.prices?.ETH?.usd ?? null,
    btcChg24hPct: snapshot.prices?.BTC?.usd24hChangePct ?? null,
    ethChg24hPct: snapshot.prices?.ETH?.usd24hChangePct ?? null,
    // stablecoins
    stableMcapUsd: snapshot.stablecoins?.totalCirculatingUsd ?? null,
    // onchain
    dexVol24hUsd: snapshot.onchain?.dexVolume24hUsd ?? null,
    // funding
    btcFunding: snapshot.fundingRates?.BTC?.fundingRate ?? null,
    ethFunding: snapshot.fundingRates?.ETH?.fundingRate ?? null,
    // OI (binance MVP)
    btcOiUsd: snapshot.openInterest?.BTC?.openInterestNotionalUsd ?? null,
    ethOiUsd: snapshot.openInterest?.ETH?.openInterestNotionalUsd ?? null,
    // liquidation sample
    btcLiqUsdEst: snapshot.liquidations?.BTC?.recentNotionalUsd_est ?? null,
    ethLiqUsdEst: snapshot.liquidations?.ETH?.recentNotionalUsd_est ?? null,

    // placeholders for future CoinGlass integration
    exchangeBtcBalancesAvailable: snapshot.exchangeBtcBalances?.available ?? false,
    solEtfAvailable: snapshot.solEtf?.available ?? false,
  };

  const idx = rows.findIndex((r) => r.day === key);
  if (idx >= 0) rows[idx] = row;
  else rows.push(row);

  // keep sorted + keep last 60 days
  rows.sort((a, b) => a.day.localeCompare(b.day));
  const trimmed = rows.slice(-60);
  saveHistory(trimmed);

  return row;
}

module.exports = {
  loadHistory,
  upsertDailySnapshot,
};
