# Meme Alpha Web (Dexscreener-only)

Small web UI to run a **Dexscreener-only** Solana meme scan on-demand and review saved snapshots.

## Run
```bash
cd apps/meme-alpha-web
npm i
npm run dev
# open http://localhost:8792
```

## API
- `GET /api/latest` -> returns last saved snapshot (from `memory/dexscreener-alpha-last.json`) and cooldown summary.
- `POST /api/scan` -> runs scanner with `--dry-run` and returns alerts.
- `POST /api/scan/save` -> same as scan, but saves snapshot.

Note: realtime Telegram push is handled by OpenClaw cron; this app does not send messages.
