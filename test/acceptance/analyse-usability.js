#!/usr/bin/env node
// Analysis of usability-study data (docs/acceptance/usability-study.md). One CSV row per participant x task
// (columns: usability-data-template.csv); SUS answers are given on each participant's rows (first non-empty used).
//   node test/acceptance/analyse-usability.js path/to/data.csv
const fs = require('fs');

// SUS (Brooke 1996): odd items score (x - 1), even items (5 - x); sum x 2.5 -> 0..100.
function sus(answers) {
  if (answers.length !== 10 || answers.some((a) => !(a >= 1 && a <= 5))) return null;
  return answers.reduce((s, a, i) => s + (i % 2 === 0 ? a - 1 : 5 - a), 0) * 2.5;
}

// Adjusted Wald interval for a completion rate (recommended for small usability samples, Sauro & Lewis).
function adjustedWald(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = (k + (z * z) / 2) / (n + z * z);
  const h = z * Math.sqrt((p * (1 - p)) / (n + z * z));
  return [Math.max(0, p - h), Math.min(1, p + h)];
}

// Two-sided 95% t critical values for small samples (df 1..30), else normal.
const T95 = [12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09, 2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05, 2.04];
function meanCI(xs) {
  const n = xs.length;
  if (!n) return { mean: null, ci95: [null, null], n };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean: m, ci95: [null, null], n };
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  const h = (T95[n - 2] ?? 1.96) * (sd / Math.sqrt(n));
  return { mean: m, ci95: [m - h, m + h], n };
}

const geomean = (xs) => (xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));
}

function analyse(rows) {
  const tasks = {};
  for (const r of rows) {
    const t = (tasks[r.task] ||= { n: 0, success: 0, times: [], seq: [], errors: 0 });
    t.n++;
    const ok = r.success === '1' && Number(r.assists || 0) <= 1;
    if (ok) { t.success++; t.times.push(Number(r.time_s)); }
    if (r.seq) t.seq.push(Number(r.seq));
    t.errors += Number(r.errors || 0);
  }
  const perTask = Object.fromEntries(Object.entries(tasks).map(([k, t]) => [k, {
    completion: t.success / t.n, completionCI95: adjustedWald(t.success, t.n), n: t.n,
    medianTimeS: median(t.times), geomeanTimeS: geomean(t.times), seq: meanCI(t.seq).mean, errors: t.errors,
  }]));
  const byParticipant = new Map();
  for (const r of rows) {
    const answers = Array.from({ length: 10 }, (_, i) => Number(r[`sus${i + 1}`]));
    if (!byParticipant.has(r.participant) && sus(answers) != null) byParticipant.set(r.participant, sus(answers));
  }
  return { participants: new Set(rows.map((r) => r.participant)).size, perTask, sus: meanCI([...byParticipant.values()]) };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: analyse-usability.js data.csv'); process.exit(2); }
  console.log(JSON.stringify(analyse(parseCsv(fs.readFileSync(file, 'utf8'))), null, 2));
}

module.exports = { sus, adjustedWald, meanCI, geomean, median, parseCsv, analyse };
