# Market Dashboard (OI) — MVP

A web dashboard to track:
- Global derivatives snapshot (MVP starts with Binance-only OI & liquidation sample)
- Stablecoin market cap (DefiLlama)
- ETF flows (TODO: add stable source)
- Funding rates (Binance Futures)
- On-chain DEX volume (DefiLlama)

## Run
```bash
npm i
npm run dev
# http://localhost:8791
```

## Notes
This MVP explicitly labels data coverage to avoid misleading “global” claims.
Next iteration will add Bybit/OKX/Deribit OI aggregation + proper global liquidation source (likely requires an API key).
