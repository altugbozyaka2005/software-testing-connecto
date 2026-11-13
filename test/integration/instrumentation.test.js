// Tests of the instrumentation itself (metrics.js, GET /metrics): an instrument we rely on to judge
// QR1 (latency) and SR4 (robustness) must itself be correct. Includes fault injection: a module
// function is replaced by one that throws, to check the socket error boundary (D4) counts and survives it.
const test = require('node:test');
const assert = require('node:assert');
const { start, stop, request, signedInSocket, matchUp, call, crashes, Client } = require('../support/helpers');
const metrics = require('../../metrics');
const chat = require('../../chat');

let base;
test.before(async () => { base = await start(); });
test.after(stop);

const getMetrics = (token = 'test-metrics-token') =>
  fetch(`${base}/metrics`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test('GET /metrics needs the token, and is absent when no token is configured', async () => {
  assert.strictEqual((await getMetrics(null)).status, 401);
  assert.strictEqual((await getMetrics('wrong-token-of-same-len')).status, 401);
  assert.strictEqual((await getMetrics('short')).status, 401);
  const ok = await getMetrics();
  assert.strictEqual(ok.status, 200);
  const body = await ok.json();
  for (const k of ['uptimeS', 'counters', 'timings', 'eventLoopDelayMs', 'memoryMb', 'gauges']) assert.ok(k in body, k);
  const saved = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = '';
  try { assert.strictEqual((await getMetrics()).status, 404); } finally { process.env.METRICS_TOKEN = saved; }
});

test('a full match increments the funnel counters and records recompute timings', async (t) => {
  const before = { sent: metrics.get('requests.sent'), accepted: metrics.get('requests.accepted'), rooms: metrics.get('rooms.opened.1to1') };
  const a = await signedInSocket(base, { firstName: 'Mia' });
  const b = await signedInSocket(base, { firstName: 'Noa' });
  t.after(() => [a, b].forEach((x) => x.sock.close()));
  await matchUp(a.sock, b.sock, 'metrics test knitting socks');
  assert.strictEqual(metrics.get('requests.sent') - before.sent, 1);
  assert.strictEqual(metrics.get('requests.accepted') - before.accepted, 1);
  assert.strictEqual(metrics.get('rooms.opened.1to1') - before.rooms, 1);
  await new Promise((r) => setTimeout(r, 200)); // let the debounced recompute run
  const snap = await (await getMetrics()).json();
  assert.ok(snap.timings['recompute.ms'].count > 0);
  assert.ok(snap.timings['recompute.ms'].p95 >= snap.timings['recompute.ms'].p50);
  assert.ok(snap.counters['socket.in.set-activity'] >= 2);
  assert.strictEqual(snap.gauges.rooms >= 1, true);
});

test('fault injection: a handler that throws is counted, acked with an error, and the server survives', async (t) => {
  const a = await signedInSocket(base, { firstName: 'Ola' });
  t.after(() => a.sock.close());
  const real = chat.send;
  chat.send = () => { throw new Error('injected fault'); };
  const errorsBefore = metrics.get('socket.handler_error.dm-send');
  const silence = console.error;
  console.error = () => {};
  try {
    const ack = await call(a.sock, 'dm-send', { to: 1, body: 'hi' });
    assert.deepStrictEqual(ack, { error: 'Something went wrong. Please try again.' });
  } finally {
    chat.send = real;
    console.error = silence;
  }
  assert.strictEqual(metrics.get('socket.handler_error.dm-send') - errorsBefore, 1);
  assert.strictEqual(crashes.length, 0);
  assert.ok((await call(a.sock, 'set-activity', { activity: 'still alive' })).ok);
});

test('refused socket connections are counted by reason', async () => {
  const before = metrics.get('socket.rejected.unauthorized');
  const s = Client(base, { forceNew: true, transports: ['websocket'] });
  await new Promise((r) => s.once('connect_error', r));
  s.close();
  assert.strictEqual(metrics.get('socket.rejected.unauthorized') - before, 1);
});

test('summary statistics use nearest-rank percentiles over the most recent samples', () => {
  const s = metrics.summary([5, 1, 4, 2, 3, 6, 7, 8, 9, 10]);
  assert.deepStrictEqual(s, { count: 10, mean: 5.5, p50: 5, p95: 10, p99: 10, max: 10 });
  assert.deepStrictEqual(metrics.summary([]), { count: 0, mean: null, p50: null, p95: null, p99: null, max: null });
  for (let i = 0; i < 2500; i++) metrics.time('ring.test', i);
  assert.strictEqual(metrics.snapshot().timings['ring.test'].count, 2000, 'window keeps the last 2000');
  assert.strictEqual(metrics.snapshot().timings['ring.test'].max, 2499);
});
