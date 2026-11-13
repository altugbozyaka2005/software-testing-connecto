// Instrumentation: in-process counters, timings and event-loop delay, so tests and operators can see
// what the realtime server is doing (test plan, docs/test-plan.md section 4).
//
//  - counters:   monotonically increasing event counts (socket events, handler errors, requests, rooms)
//  - timings:    the last WINDOW samples of a duration (ms), summarised as p50/p95/p99/max
//  - event loop: delay of Node's event loop, the first thing to degrade when matching gets too slow
//
// Exposed as JSON at GET /metrics when METRICS_TOKEN is set (Authorization: Bearer <token>), and to
// tests directly via snapshot(). Nothing personal is recorded: only counts and durations.
const { monitorEventLoopDelay } = require('perf_hooks');

const WINDOW = 2000;
const counters = new Map();
const timings = new Map(); // name -> { samples: number[], next: index }
const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
const startedAt = Date.now();

function inc(name, by = 1) {
  counters.set(name, (counters.get(name) || 0) + by);
}

function time(name, ms) {
  let t = timings.get(name);
  if (!t) timings.set(name, (t = { samples: [], next: 0 }));
  if (t.samples.length < WINDOW) t.samples.push(ms);
  else t.samples[t.next] = ms; // ring buffer: keep the most recent WINDOW samples
  t.next = (t.next + 1) % WINDOW;
}

// Returns a function that records the elapsed time when called.
function startTimer(name) {
  const t0 = process.hrtime.bigint();
  return () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    time(name, ms);
    return ms;
  };
}

// Nearest-rank percentile of a sorted array.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summary(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  return {
    count: sorted.length,
    mean: round(sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.at(-1) ?? null),
  };
}

function snapshot(gauges = {}) {
  return {
    uptimeS: Math.round((Date.now() - startedAt) / 1000),
    counters: Object.fromEntries([...counters].sort(([a], [b]) => a.localeCompare(b))),
    timings: Object.fromEntries([...timings].map(([k, v]) => [k, summary(v.samples)])),
    eventLoopDelayMs: { p50: loop.percentile(50) / 1e6, p99: loop.percentile(99) / 1e6, max: loop.max / 1e6 },
    memoryMb: Math.round(process.memoryUsage().rss / 1e5) / 10,
    gauges,
  };
}

function reset() {
  counters.clear();
  timings.clear();
  loop.reset();
}

const get = (name) => counters.get(name) || 0;

module.exports = { inc, time, startTimer, snapshot, summary, percentile, reset, get };
