// A small greedy pairwise (all-pairs) test generator (AETG-style), used by test/unit/prefs.pairwise.test.js.
// Given { param: [values] }, returns rows (objects) such that every pair of values of every two
// parameters appears in at least one row. Deterministic (seeded), so the generated suite is stable.
function pairwise(params, { candidates = 60, seed = 1 } = {}) {
  const names = Object.keys(params);
  let state = seed;
  const rand = (n) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % n;
  };
  const key = (i, vi, j, vj) => `${i}:${vi}|${j}:${vj}`;
  const uncovered = new Set();
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (let vi = 0; vi < params[names[i]].length; vi++)
        for (let vj = 0; vj < params[names[j]].length; vj++) uncovered.add(key(i, vi, j, vj));

  const gain = (row) => {
    let g = 0;
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) if (uncovered.has(key(i, row[i], j, row[j]))) g++;
    return g;
  };
  const rows = [];
  while (uncovered.size) {
    // Seed each candidate with one still-uncovered pair so every iteration makes progress.
    const [first] = uncovered;
    const [[i, vi], [j, vj]] = first.split('|').map((p) => p.split(':').map(Number));
    let best = null;
    let bestGain = -1;
    for (let c = 0; c < candidates; c++) {
      const row = names.map((n) => rand(params[n].length));
      row[i] = vi;
      row[j] = vj;
      const g = gain(row);
      if (g > bestGain) [best, bestGain] = [row, g];
    }
    for (let a = 0; a < names.length; a++)
      for (let b = a + 1; b < names.length; b++) uncovered.delete(key(a, best[a], b, best[b]));
    rows.push(best);
  }
  return rows.map((r) => Object.fromEntries(names.map((n, k) => [n, params[n][r[k]]])));
}

// Checks a suite really covers all pairs (the generator's own oracle).
function missingPairs(params, rows) {
  const names = Object.keys(params);
  const missing = [];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (const vi of params[names[i]])
        for (const vj of params[names[j]])
          if (!rows.some((r) => r[names[i]] === vi && r[names[j]] === vj)) missing.push([names[i], vi, names[j], vj]);
  return missing;
}

module.exports = { pairwise, missingPairs };
