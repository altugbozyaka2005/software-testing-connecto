// Statistics used to evaluate test results (LO4): percentiles with bootstrap confidence intervals
// (performance), Wilson score intervals for proportions (mutation score, A/B accuracy), the exact
// McNemar test for paired comparisons (A/B of two matchers on the same pairs), and the "rule of three"
// upper bound for a failure rate when no failures were observed. Deterministic (seeded) where random.

function quantile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function rng(seed = 42) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

// Percentile bootstrap CI for any statistic of a sample.
function bootstrapCI(values, stat, { reps = 2000, alpha = 0.05, seed = 7 } = {}) {
  const r = rng(seed);
  const n = values.length;
  const est = [];
  for (let i = 0; i < reps; i++) {
    const sample = new Array(n);
    for (let j = 0; j < n; j++) sample[j] = values[Math.floor(r() * n)];
    est.push(stat(sample));
  }
  return [quantile(est, alpha / 2), quantile(est, 1 - alpha / 2)];
}

// Wilson score interval for k successes out of n (better than the normal approximation near 0 or 1).
function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}

function binomPmf(k, n) {
  let logC = 0;
  for (let i = 1; i <= k; i++) logC += Math.log(n - k + i) - Math.log(i);
  return Math.exp(logC - n * Math.LN2);
}

// Exact (binomial) McNemar test. b = pairs only A got right, c = pairs only B got right.
function mcnemarExact(b, c) {
  const n = b + c;
  if (!n) return 1;
  const k = Math.min(b, c);
  let p = 0;
  for (let i = 0; i <= k; i++) p += binomPmf(i, n);
  return Math.min(1, 2 * p);
}

// 95% upper bound on a failure probability after n failure-free independent trials (≈ 3/n).
function ruleOfThree(n) {
  return 1 - Math.pow(0.05, 1 / n);
}

module.exports = { quantile, mean, rng, bootstrapCI, wilson, mcnemarExact, ruleOfThree };
