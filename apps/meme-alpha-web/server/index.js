const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Reuse the scanner from tools/ (single source of truth)
const SCANNER = path.resolve(__dirname, '../../tools/meme-alpha/dex_push.js');
const STATE_PATH = path.resolve(__dirname, '../../memory/dexscreener-alpha-state.json');
const LAST_ALERTS_PATH = path.resolve(__dirname, '../../memory/dexscreener-alpha-last.json');

app.use(express.static(PUBLIC_DIR));

function readJsonSafe(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function runScan() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCANNER, '--emit-json', '--dry-run'], {
      cwd: path.resolve(__dirname, '../../'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (err += d.toString('utf8')));

    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`scan failed code=${code}: ${err.slice(0, 400)}`));
      const lines = out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const alerts = [];
      for (const line of lines) {
        try {
          alerts.push(JSON.parse(line));
        } catch {
          // ignore
        }
      }
      resolve({ alerts });
    });
  });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, now: Date.now() });
});

// Latest saved alerts (from cron runs or manual save)
app.get('/api/latest', (req, res) => {
  const last = readJsonSafe(LAST_ALERTS_PATH, { whenMs: null, alerts: [] });
  const state = readJsonSafe(STATE_PATH, { sentPairs: {}, lastRunMs: null });
  res.json({ last, stateSummary: { lastRunMs: state.lastRunMs ?? null, sentPairs: Object.keys(state.sentPairs || {}).length } });
});

// Run a scan on-demand (no side effects because --dry-run)
app.post('/api/scan', express.json(), async (req, res) => {
  try {
    const { alerts } = await runScan();
    res.json({ ok: true, whenMs: Date.now(), alerts });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Save a scan result snapshot (still no side effects on scanner state because we run dry-run)
app.post('/api/scan/save', express.json(), async (req, res) => {
  try {
    const { alerts } = await runScan();
    const payload = { whenMs: Date.now(), alerts };
    fs.mkdirSync(path.dirname(LAST_ALERTS_PATH), { recursive: true });
    fs.writeFileSync(LAST_ALERTS_PATH, JSON.stringify(payload, null, 2) + '\n');
    res.json({ ok: true, saved: true, ...payload });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

const port = Number(process.env.PORT || 8792);
app.listen(port, () => {
  console.log(`meme-alpha-web listening on :${port}`);
  console.log(`scanner: ${SCANNER}`);
});
