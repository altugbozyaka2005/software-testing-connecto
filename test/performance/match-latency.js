#!/usr/bin/env node
// Performance / stress test for QR1: "With 100 people searching at once, when someone changes what
// they are doing, every searching person receives an updated match list within 1 s (95th percentile)."
//
// The server runs as a separate process (so the load generator doesn't share its event loop), with an
// in-memory database and word matching only (EMBEDDINGS=off; see docs/evaluation.md for why).
// Load levels step up to find the edge of the operational envelope (Y&P ch. 22). For each level:
//   - N signed-in users search for activities drawn from a synthetic operational profile;
//   - TRIALS times, one random user changes activity; latency = time until every other searching
//     user has received a 'matches' event (fan-out latency);
//   - server-side recompute duration and event-loop delay come from GET /metrics.
// Results: reports/performance/latency.json and latency.md (p50/p95 with bootstrap 95% CIs).
//
//   node test/performance/match-latency.js            # levels 10,25,50,100,200
//   LEVELS=10,50 TRIALS=20 node test/performance/match-latency.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { io: Client } = require('socket.io-client');
const { quantile, bootstrapCI, mean } = require('../support/stats');
const { activityFor } = require('./profile');

const LEVELS = (process.env.LEVELS || '10,25,50,100,200').split(',').map(Number);
const TRIALS = Number(process.env.TRIALS) || 40;
const TARGET_P95_MS = 1000;
const PORT = 4100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'perf-token';
const OUT = path.join(__dirname, '..', '..', 'reports', 'performance');

function startServer() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: ':memory:', EMBEDDINGS: 'off', AUTH_RATE_LIMIT: '1000000', METRICS_TOKEN: TOKEN, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const tokens = new Map(); // email -> verification token, read from the console mail transport
  let buf = '';
  let lastTo = null;
  child.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const to = line.match(/^\[mail\] To: (.+)$/);
      if (to) lastTo = to[1];
      const tok = line.match(/\?verify=([A-Za-z0-9_-]+)/);
      if (tok && lastTo) tokens.set(lastTo, tok[1]);
    }
  });
  return new Promise((resolve) => {
    const poll = setInterval(async () => {
      try { if ((await fetch(`${BASE}/health`)).ok) { clearInterval(poll); resolve({ child, tokens }); } } catch { /* not up yet */ }
    }, 100);
  });
}

async function post(p, body, cookie) {
  const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { res, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

let made = 0;
// Names must be letters only (FR1), so number users as a, b, ..., z, ba, bb, ...
const letters = (n) => (n < 26 ? 'Load' + String.fromCharCode(97 + n) : letters(Math.floor(n / 26)) + String.fromCharCode(97 + (n % 26)));
async function makeUser(tokens) {
  const email = `perf${++made}_${PORT}@example.com`;
  const { cookie } = await post('/api/auth/register', {
    firstName: 'Perf', lastName: letters(made), email, password: 'perfpass123', dateOfBirth: '1995-05-05', acceptTerms: true,
  });
  if (!cookie) throw new Error(`could not register ${email}`);
  for (let i = 0; i < 50 && !tokens.has(email); i++) await new Promise((r) => setTimeout(r, 20));
  await post('/api/auth/verify-email', { token: tokens.get(email) });
  const sock = Client(BASE, { forceNew: true, transports: ['websocket'], extraHeaders: { cookie } });
  await new Promise((r, j) => { sock.once('connect', r); sock.once('connect_error', j); });
  return sock;
}

const call = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));
const metricsNow = async () => (await fetch(`${BASE}/metrics`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();

async function runLevel(n, tokens, pool) {
  while (pool.length < n) pool.push(await makeUser(tokens));
  const socks = pool.slice(0, n);
  for (const [i, s] of socks.entries()) await call(s, 'set-activity', { activity: activityFor(i) });
  await new Promise((r) => setTimeout(r, 1500)); // settle
  const before = await metricsNow();
  const latencies = [];
  for (let t = 0; t < TRIALS; t++) {
    const mover = socks[Math.floor(Math.random() * n)];
    const others = socks.filter((s) => s !== mover);
    const t0 = performance.now();
    const all = Promise.all(others.map((s) => new Promise((r) => s.once('matches', r))));
    await call(mover, 'set-activity', { activity: activityFor(n + t * 7) });
    await all;
    latencies.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, Math.max(200, latencies.at(-1)))); // let the previous pass finish
  }
  const after = await metricsNow();
  const rec = after.timings['recompute.ms'];
  const p95 = quantile(latencies, 0.95);
  return {
    users: n,
    trials: TRIALS,
    latencyMs: {
      p50: +quantile(latencies, 0.5).toFixed(1),
      p95: +p95.toFixed(1),
      max: +Math.max(...latencies).toFixed(1),
      mean: +mean(latencies).toFixed(1),
      p95CI95: bootstrapCI(latencies, (x) => quantile(x, 0.95)).map((v) => +v.toFixed(1)),
    },
    recomputeMs: { p50: rec.p50, p95: rec.p95, max: rec.max, passes: (after.counters['recompute.passes'] || 0) - (before.counters['recompute.passes'] || 0) },
    eventLoopDelayP99Ms: +after.eventLoopDelayMs.p99.toFixed(1),
    serverMemoryMb: after.memoryMb,
    meetsTarget: p95 <= TARGET_P95_MS,
  };
}

(async () => {
  const { child, tokens } = await startServer();
  const pool = [];
  const results = [];
  try {
    for (const n of LEVELS) {
      const r = await runLevel(n, tokens, pool);
      results.push(r);
      console.log(`${String(n).padStart(4)} users  p50 ${r.latencyMs.p50} ms  p95 ${r.latencyMs.p95} ms [${r.latencyMs.p95CI95.join(', ')}]  recompute p95 ${r.recomputeMs.p95} ms  loop p99 ${r.eventLoopDelayP99Ms} ms  ${r.meetsTarget ? 'OK' : 'ABOVE TARGET'}`);
    }
  } finally {
    pool.forEach((s) => s.close());
    child.kill();
  }
  fs.mkdirSync(OUT, { recursive: true });
  const meta = { date: new Date().toISOString(), node: process.version, platform: `${process.platform}/${process.arch}`, targetP95Ms: TARGET_P95_MS, embeddings: 'off', trialsPerLevel: TRIALS };
  fs.writeFileSync(path.join(OUT, 'latency.json'), JSON.stringify({ meta, results }, null, 2));
  const rows = results.map((r) => `| ${r.users} | ${r.latencyMs.p50} | ${r.latencyMs.p95} | ${r.latencyMs.p95CI95.join(' – ')} | ${r.latencyMs.max} | ${r.recomputeMs.p95} | ${r.eventLoopDelayP99Ms} | ${r.serverMemoryMb} | ${r.meetsTarget ? 'yes' : '**no**'} |`);
  fs.writeFileSync(path.join(OUT, 'latency.md'), [
    `# Match-update latency (QR1), ${meta.date.slice(0, 10)}`,
    '',
    `Node ${meta.node} on ${meta.platform}; embeddings ${meta.embeddings}; ${TRIALS} trials per level; target p95 ≤ ${TARGET_P95_MS} ms.`,
    'Latency includes the server\'s 120 ms debounce. CI = 95% bootstrap confidence interval of the p95.',
    '',
    '| Searching users | p50 (ms) | p95 (ms) | p95 95% CI | max (ms) | server recompute p95 (ms) | event-loop delay p99 (ms) | server RSS (MB) | meets target |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n'));
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}/latency.{json,md}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
