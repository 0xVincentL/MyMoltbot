# Smart Money (Whale Monitor) — Solana MVP

Tracks a configurable list of Solana wallets and emits alerts/events when the wallet's SOL balance change exceeds a threshold.

This is a **free / no-key** MVP using public Solana JSON-RPC. Expect rate limits; for production, use a paid RPC (Helius/QuickNode/etc.) via `SOLANA_RPC_URL`.

## Files
- `wallets.json` — list of tracked wallets
- `memory/smart-money/solana-checkpoints.json` — per-wallet last processed signature
- `memory/smart-money/solana-events.jsonl` — append-only event log
- `memory/smart-money/solana-summary.json` — rolling summary (last 24h)

## Run
```bash
cd /home/codespace/clawd/MyMoltbot
node tools/smart-money/sol_whale_monitor.js --threshold-sol 100 --limit 30
```

Env:
- `SOLANA_RPC_URL` (default: https://api.mainnet-beta.solana.com)

## Next
- Add token swap classification (DEX) via log messages / program ids
- Add Telegram push + dashboard card
