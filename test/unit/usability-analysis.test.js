// The usability analysis tool is part of the acceptance-test instrumentation, so it is tested too.
// Inputs here are synthetic and only check the arithmetic; they are not study results.
const test = require('node:test');
const assert = require('node:assert');
const { sus, adjustedWald, meanCI, median, geomean, parseCsv, analyse } = require('../acceptance/analyse-usability');

test('SUS scoring: best, worst, neutral and invalid answer sets', () => {
  assert.strictEqual(sus([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100);
  assert.strictEqual(sus([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), 0);
  assert.strictEqual(sus([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 50);
  assert.strictEqual(sus([4, 2, 4, 2, 4, 2, 4, 2, 4, 2]), 75);
  assert.strictEqual(sus([5, 1, 5]), null);
  assert.strictEqual(sus([6, 1, 5, 1, 5, 1, 5, 1, 5, 1]), null);
});

test('Adjusted Wald interval for completion rates (hand-computed values)', () => {
  const [lo, hi] = adjustedWald(9, 10);
  assert.ok(Math.abs(lo - 0.574) < 0.005 && Math.abs(hi - 1) < 0.005, `${lo} ${hi}`);
  const [lo2, hi2] = adjustedWald(0, 5);
  assert.strictEqual(lo2, 0);
  assert.ok(hi2 > 0.4 && hi2 < 0.5);
});

test('summary statistics', () => {
  assert.strictEqual(median([5, 1, 3]), 3);
  assert.strictEqual(median([4, 1, 3, 2]), 2.5);
  assert.ok(Math.abs(geomean([1, 100]) - 10) < 1e-9);
  const m = meanCI([60, 70, 80]);
  assert.strictEqual(m.mean, 70);
  assert.ok(Math.abs(m.ci95[0] - (70 - 4.30 * 10 / Math.sqrt(3))) < 1e-9);
});

test('analyse: completion counts one assist as success, two as failure; SUS once per participant', () => {
  const csv = [
    'participant,group,device,task,success,assists,time_s,errors,seq,sus1,sus2,sus3,sus4,sus5,sus6,sus7,sus8,sus9,sus10',
    'p1,G1,phone,T1,1,0,60,0,6,4,2,4,2,4,2,4,2,4,2',
    'p1,G1,phone,T2,1,2,30,1,4,,,,,,,,,,',
    'p2,G2,laptop,T1,1,1,90,1,5,3,3,3,3,3,3,3,3,3,3',
    'p2,G2,laptop,T2,0,0,120,2,2,,,,,,,,,,',
  ].join('\n');
  const r = analyse(parseCsv(csv));
  assert.strictEqual(r.participants, 2);
  assert.strictEqual(r.perTask.T1.completion, 1);
  assert.strictEqual(r.perTask.T2.completion, 0);
  assert.strictEqual(r.perTask.T1.medianTimeS, 75);
  assert.strictEqual(r.perTask.T2.errors, 3);
  assert.strictEqual(r.sus.mean, 62.5);
});
