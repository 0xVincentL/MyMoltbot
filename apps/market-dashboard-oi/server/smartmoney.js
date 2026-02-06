const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SUMMARY_PATH = path.join(ROOT, 'memory', 'smart-money', 'solana-summary.json');

function readSummary() {
  try {
    return JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
  } catch {
    return { ok: false, error: 'missing summary; run tools/smart-money/sol_whale_monitor.js' };
  }
}

module.exports = { readSummary, SUMMARY_PATH };
