#!/usr/bin/env node
// Offline A/B evaluation of the two matchers on the labelled pairs in pairs.js (requirement FR2, QR3).
//   A = word matching only (what runs when the embedding model is unavailable, EMBEDDINGS=off)
//   B = word matching + meaning (production: max(lexical, semantic))
// A pair is predicted a match when score >= MIN_SCORE (0.15, server.js). Reports accuracy, precision,
// recall with Wilson 95% intervals, the exact McNemar test on the pairs where A and B disagree,
// per-group recall/specificity, a threshold sweep, and the sample size an online A/B test would need.
// Output: reports/ab/matcher-ab.json and matcher-ab.md. Needs the model in ./models (scripts/fetch-model.js).
const fs = require('fs');
const path = require('path');
const { analyze, lexical, score, semantic } = require('../../matcher');
const embeddings = require('../../embeddings');
const { wilson, mcnemarExact } = require('../support/stats');
const pairs = require('./pairs');

const MIN_SCORE = 0.15;
const OUT = path.join(__dirname, '..', '..', 'reports', 'ab');

function confusion(pred, labels) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  pred.forEach((p, i) => { if (p && labels[i]) tp++; else if (p) fp++; else if (labels[i]) fn++; else tn++; });
  const n = labels.length;
  const r = (k, d) => ({ value: d ? +(k / d).toFixed(3) : null, ci95: wilson(k, d).map((x) => (x == null ? null : +x.toFixed(3))), k, n: d });
  return { tp, fp, tn, fn, accuracy: r(tp + tn, n), precision: r(tp, tp + fp), recall: r(tp, tp + fn), specificity: r(tn, tn + fp) };
}

// Candidate C (exploratory, not in production): the same word signals without the "same category => at
// least 0.3 + 0.4 x overlap" floor, combined with meaning. Generic verbs ("playing", "watching") are category
// triggers, so the floor makes "playing chess" vs "playing football" score 0.7 whatever the model says.
function lexicalNoFloor(a, b) {
  const jac = (x, y) => { if (!x.size || !y.size) return 0; let i = 0; for (const v of x) if (y.has(v)) i++; return i / (x.size + y.size - i); };
  const cos = (x, y) => { if (!x.size || !y.size) return 0; let i = 0; for (const v of x) if (y.has(v)) i++; return i / Math.sqrt(x.size * y.size); };
  const kw = cos(a.stems, b.stems);
  let s = 0.45 * jac(a.categories, b.categories) + 0.35 * kw + 0.2 * jac(a.grams, b.grams);
  if (kw === 1 && a.stems.size) s = Math.max(s, 0.95);
  return Math.min(1, s);
}
const candidateC = (a, b) => Math.max(lexicalNoFloor(a, b), semantic(a, b));

// Sample size per arm to detect p1 -> p2 with a two-sided two-proportion z-test (alpha .05, power .8).
function sampleSize(p1, p2, zA = 1.96, zB = 0.8416) {
  const pbar = (p1 + p2) / 2;
  const num = zA * Math.sqrt(2 * pbar * (1 - pbar)) + zB * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((num * num) / ((p1 - p2) ** 2));
}

(async () => {
  if (!(await embeddings.load())) throw new Error('embedding model unavailable: run node scripts/fetch-model.js');
  const rows = [];
  for (const [group, a, b, label] of pairs) {
    const [pa, pb] = [analyze(a), analyze(b)];
    await Promise.all([embeddings.attach(pa, a), embeddings.attach(pb, b)]);
    rows.push({ group, a, b, label, A: +lexical(pa, pb).toFixed(3), B: +score(pa, pb).toFixed(3), C: +candidateC(pa, pb).toFixed(3) });
  }
  const labels = rows.map((r) => r.label);
  const predA = rows.map((r) => r.A >= MIN_SCORE);
  const predB = rows.map((r) => r.B >= MIN_SCORE);
  // C is tuned on these same pairs, so its numbers are optimistic (no hold-out set): exploratory only.
  const bestC = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map((t) => ({ t, acc: rows.filter((r) => (r.C >= t) === !!r.label).length })).sort((x, y) => y.acc - x.acc)[0].t;
  const predC = rows.map((r) => r.C >= bestC);
  const correctC = predC.map((p, i) => p === !!labels[i]);
  const correctA = predA.map((p, i) => p === !!labels[i]);
  const correctB = predB.map((p, i) => p === !!labels[i]);
  const onlyA = correctA.filter((c, i) => c && !correctB[i]).length;
  const onlyB = correctB.filter((c, i) => c && !correctA[i]).length;

  const groups = {};
  for (const g of [...new Set(rows.map((r) => r.group))]) {
    const rs = rows.filter((r) => r.group === g);
    const hit = (v) => rs.filter((r) => (r[v] >= MIN_SCORE) === !!r.label).length;
    groups[g] = { pairs: rs.length, label: rs[0].label ? 'match' : 'no match', correctA: hit('A'), correctB: hit('B'), correctC: rs.filter((r) => (r.C >= bestC) === !!r.label).length };
  }
  const sweep = [0.1, 0.15, 0.2, 0.3, 0.4, 0.5].map((t) => {
    const acc = (v) => rows.filter((r) => (r[v] >= t) === !!r.label).length / rows.length;
    return { threshold: t, accuracyA: +acc('A').toFixed(3), accuracyB: +acc('B').toFixed(3), accuracyC: +acc('C').toFixed(3) };
  });
  const result = {
    date: new Date().toISOString(), pairs: rows.length, matches: labels.filter(Boolean).length, threshold: MIN_SCORE,
    A: confusion(predA, labels), B: confusion(predB, labels), C: { threshold: bestC, ...confusion(predC, labels) },
    mcnemar: { onlyACorrect: onlyA, onlyBCorrect: onlyB, pExact: +mcnemarExact(onlyA, onlyB).toPrecision(3) },
    mcnemarBvsC: (() => { const b = correctB.filter((c, i) => c && !correctC[i]).length; const c = correctC.filter((x, i) => x && !correctB[i]).length; return { onlyBCorrect: b, onlyCCorrect: c, pExact: +mcnemarExact(b, c).toPrecision(3) }; })(),
    groups, sweep,
    onlineTest: {
      metric: 'share of match requests that are accepted',
      assumedBaseline: 0.3, minimumDetectableLift: 0.05,
      perArm: sampleSize(0.30, 0.35), alpha: 0.05, power: 0.8,
    },
    wrongB: rows.filter((r, i) => !correctB[i]),
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'matcher-ab.json'), JSON.stringify({ ...result, rows }, null, 2));
  const f = (m) => `${m.value} [${m.ci95.join(', ')}]`;
  const md = [
    `# Offline A/B: word matching (A) vs word + meaning (B), ${result.date.slice(0, 10)}`, '',
    `${result.pairs} labelled pairs (${result.matches} should match), match threshold ${MIN_SCORE}. 95% Wilson intervals in brackets.`, '',
    '| Metric | A: words only | B: words + meaning |', '|---|---|---|',
    ...['accuracy', 'precision', 'recall', 'specificity'].map((k) => `| ${k} | ${f(result.A[k])} | ${f(result.B[k])} |`),
    `| errors (FP / FN) | ${result.A.fp} / ${result.A.fn} | ${result.B.fp} / ${result.B.fn} |`, '',
    `Exact McNemar test on the ${onlyA + onlyB} pairs where they disagree: only A right ${onlyA}, only B right ${onlyB}, p = ${result.mcnemar.pExact}.`, '',
    `Exploratory candidate C (no category floor, best threshold ${bestC}, tuned on the same pairs so optimistic): accuracy ${f(result.C.accuracy)}, precision ${f(result.C.precision)}, recall ${f(result.C.recall)}, specificity ${f(result.C.specificity)}. McNemar B vs C: only B right ${result.mcnemarBvsC.onlyBCorrect}, only C right ${result.mcnemarBvsC.onlyCCorrect}, p = ${result.mcnemarBvsC.pExact}.`, '',
    '| Kind of pair | pairs | expected | A correct | B correct | C correct |', '|---|---|---|---|---|---|',
    ...Object.entries(groups).map(([g, v]) => `| ${g} | ${v.pairs} | ${v.label} | ${v.correctA} | ${v.correctB} | ${v.correctC} |`), '',
    '| Threshold | accuracy A | accuracy B | accuracy C |', '|---|---|---|---|', ...sweep.map((s) => `| ${s.threshold} | ${s.accuracyA} | ${s.accuracyB} | ${s.accuracyC} |`), '',
    `Online follow-up: to detect a lift in request acceptance from 30% to 35% (α = 0.05, power 0.8) needs ${result.onlineTest.perArm} requests per arm.`, '',
    '## Pairs B gets wrong', '', '| kind | a | b | expected | B score |', '|---|---|---|---|---|',
    ...result.wrongB.map((r) => `| ${r.group} | ${r.a} | ${r.b} | ${r.label ? 'match' : 'no match'} | ${r.B} |`), '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'matcher-ab.md'), md);
  console.log(md.split('\n').slice(0, 14).join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
