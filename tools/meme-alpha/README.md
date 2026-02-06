# Dexscreener Meme Alpha (push)

Scans Solana meme tokens using **Dexscreener-only** public endpoints and emits alert candidates for Telegram.

## Data sources (public)
- Latest token profiles: https://api.dexscreener.com/token-profiles/latest/v1
- Top boosts (paid / trending-ish): https://api.dexscreener.com/token-boosts/top/v1
- Latest boosts: https://api.dexscreener.com/token-boosts/latest/v1
- Token pairs: https://api.dexscreener.com/latest/dex/tokens/<tokenAddress>

## Run
```bash
node tools/meme-alpha/dex_push.js --dry-run
node tools/meme-alpha/dex_push.js --emit-json
```

State is stored at `memory/dexscreener-alpha-state.json`.
