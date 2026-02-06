const express = require('express');
const cors = require('cors');
const path = require('path');
const { z } = require('zod');

const {
  fetchStablecoins,
  fetchDefiLlamaDexVolume,
  fetchBinanceFundingRates,
  fetchBinanceOpenInterest,
  fetchBinanceLiquidations,
  fetchCoingeckoPrices,
} = require('./sources');

const { loadHistory, upsertDailySnapshot } = require('./storage');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/', express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

const SnapshotQuery = z.object({
  symbols: z.string().optional(), // comma-separated: BTC,ETH
});

app.get('/api/history', (req, res) => {
  const days = Math.max(1, Math.min(60, Number(req.query.days || 15)));
  const rows = loadHistory();
  res.json({ ok: true, days, rows: rows.slice(-days) });
});

app.get('/api/snapshot', async (req, res) => {
  const parsed = SnapshotQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.issues });

  const symbols = (parsed.data.symbols || 'BTC,ETH')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  try {
    // Run in parallel
    const [stable, dexVol, prices, funding, oi, liq] = await Promise.all([
      fetchStablecoins(),
      fetchDefiLlamaDexVolume(),
      fetchCoingeckoPrices(symbols),
      fetchBinanceFundingRates(symbols),
      fetchBinanceOpenInterest(symbols),
      fetchBinanceLiquidations(symbols),
    ]);

    // Minimal “global” aggregation (MVP): Binance-only for OI / liquidations.
    // We keep it explicit to avoid misleading users.
    const payload = {
      ok: true,
      asOf: new Date().toISOString(),
      prices,
      stablecoins: stable,
      onchain: {
        dexVolume24hUsd: dexVol?.total24hUsd ?? null,
        dexVolume24hUsd_source: dexVol?.source ?? null,
      },
      fundingRates: funding,
      openInterest: oi,
      liquidations: liq,
      notes: {
        oiCoverage: 'MVP uses Binance Futures open interest only (not full global). Next: add Bybit/OKX/Deribit aggregation.',
        liquidationCoverage: 'MVP uses Binance Futures liquidation stream approximation (not full global).',
        etf: 'ETF flows require a dedicated source; not wired in MVP yet.',
      },
    };

    // persist daily snapshot for charts (15d)
    const stored = upsertDailySnapshot(payload);
    payload.storedDaily = stored;

    res.json(payload);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 8791);
app.listen(port, () => {
  console.log(`market-dashboard-oi listening on http://localhost:${port}`);
});
