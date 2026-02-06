const fetchMod = require('node-fetch');
const fetch = fetchMod.default || fetchMod;

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'user-agent': 'MyMoltbot/market-dashboard-oi',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// Stablecoin total market cap (DefiLlama)
async function fetchStablecoins() {
  const url = 'https://stablecoins.llama.fi/stablecoins';
  const j = await fetchJson(url);
  // j.totalCirculatingUSD exists on newer versions; fallback sum.
  const total = num(j?.totalCirculatingUSD);
  let totalUsd = total;
  if (totalUsd == null && Array.isArray(j?.peggedAssets)) {
    totalUsd = j.peggedAssets.reduce((acc, a) => acc + (num(a?.circulating?.peggedUSD) || 0), 0);
  }
  return {
    totalCirculatingUsd: totalUsd,
    source: url,
  };
}

// DEX volume 24h total (DefiLlama)
async function fetchDefiLlamaDexVolume() {
  // Overview endpoint provides total DEX volume 24h.
  const url = 'https://api.llama.fi/overview/dexs';
  const j = await fetchJson(url);
  // Known key: total24h. If missing, keep null.
  return {
    total24hUsd: num(j?.total24h),
    source: url,
  };
}

// Prices (CoinGecko simple)
async function fetchCoingeckoPrices(symbols) {
  const map = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    SOL: 'solana',
  };
  const ids = symbols.map((s) => map[s]).filter(Boolean);
  if (!ids.length) return {};
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;
  const j = await fetchJson(url);
  const out = {};
  for (const sym of symbols) {
    const id = map[sym];
    if (!id || !j[id]) continue;
    out[sym] = {
      usd: num(j[id].usd),
      usd24hChangePct: num(j[id].usd_24h_change),
      updatedAt: j[id].last_updated_at ? new Date(j[id].last_updated_at * 1000).toISOString() : null,
      source: 'coingecko',
    };
  }
  return out;
}

// Binance funding rate (premiumIndex)
async function fetchBinanceFundingRates(symbols) {
  const out = {};
  for (const sym of symbols) {
    const pair = `${sym}USDT`;
    const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${pair}`;
    const j = await fetchJson(url);
    out[sym] = {
      symbol: pair,
      fundingRate: num(j?.lastFundingRate),
      nextFundingTime: j?.nextFundingTime ? new Date(Number(j.nextFundingTime)).toISOString() : null,
      markPrice: num(j?.markPrice),
      source: 'binance-futures',
    };
  }
  return out;
}

// Binance open interest (contracts) + USD notional estimate via markPrice
async function fetchBinanceOpenInterest(symbols) {
  const out = {};
  for (const sym of symbols) {
    const pair = `${sym}USDT`;
    const oiUrl = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${pair}`;
    const premUrl = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${pair}`;
    const [oi, prem] = await Promise.all([fetchJson(oiUrl), fetchJson(premUrl)]);
    const openInterest = num(oi?.openInterest);
    const mark = num(prem?.markPrice);
    out[sym] = {
      symbol: pair,
      openInterestContracts: openInterest,
      markPrice: mark,
      openInterestNotionalUsd: openInterest != null && mark != null ? openInterest * mark : null,
      time: oi?.time ? new Date(Number(oi.time)).toISOString() : null,
      source: 'binance-futures',
    };
  }
  return out;
}

// Binance liquidations (MVP proxy): last 24h agg from forceOrders? This endpoint is limited.
// We'll fetch a small recent window and sum qty*price as a rough "recent liq" metric.
async function fetchBinanceLiquidations(symbols) {
  // NOTE: Binance forceOrders may require additional permissions and can return 401.
  // We treat it as optional and never fail the whole snapshot.
  const out = {};
  for (const sym of symbols) {
    const pair = `${sym}USDT`;
    const url = `https://fapi.binance.com/fapi/v1/forceOrders?symbol=${pair}&limit=50`;
    try {
      const arr = await fetchJson(url);
      let sumUsd = 0;
      let n = 0;
      if (Array.isArray(arr)) {
        for (const x of arr) {
          const p = num(x?.price);
          const q = num(x?.origQty);
          if (p != null && q != null) {
            sumUsd += p * q;
            n += 1;
          }
        }
      }
      out[sym] = {
        symbol: pair,
        recentForceOrders: n,
        recentNotionalUsd_est: n ? sumUsd : 0,
        note: 'Binance recent forceOrders sample (not full 24h global liquidation).',
        source: 'binance-futures',
      };
    } catch (e) {
      out[sym] = {
        symbol: pair,
        recentForceOrders: null,
        recentNotionalUsd_est: null,
        note: `Unavailable (${String(e.message || e)})`,
        source: 'binance-futures',
      };
    }
  }
  return out;
}

module.exports = {
  fetchStablecoins,
  fetchDefiLlamaDexVolume,
  fetchCoingeckoPrices,
  fetchBinanceFundingRates,
  fetchBinanceOpenInterest,
  fetchBinanceLiquidations,
};
