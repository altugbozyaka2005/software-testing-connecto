// Unit tests for matcher.js (requirement FR2 at unit level): systematic functional testing.
//  - stem(): boundary-value analysis of each suffix rule's length threshold (BV-STEM-n).
//  - tokenize()/score(): category partition over the kinds of text people type (TS-MAT-n),
//    see docs/test-specs/matcher-category-partition.md.
// The word-based scorer is what runs when the embedding model is unavailable (EMBEDDINGS=off),
// so it has to be correct on its own.
const test = require('node:test');
const assert = require('node:assert');
const { analyze, score, lexical, semantic, tokenize, stem } = require('../../matcher');

const MIN_SCORE = 0.15; // server.js: the lowest score shown as a match
const s = (a, b) => score(analyze(a), analyze(b));

test('BV-STEM-1: "ies" is stripped only from words longer than 5 letters', () => {
  assert.strictEqual(stem('studies'), 'studi'); // 7 letters
  assert.strictEqual(stem('series'), 'seri'); // 6 letters: just above the boundary
  assert.strictEqual(stem('pies'), 'pi'); // 4 letters: falls through to the "es" rule
});

test('BV-STEM-2: "ing" is stripped only from words longer than 4 letters', () => {
  assert.strictEqual(stem('coding'), 'cod');
  assert.strictEqual(stem('bring'), 'br'); // 5 letters: stripped
  assert.strictEqual(stem('sing'), 'sing'); // 4 letters: kept
  assert.strictEqual(stem('ring'), 'ring');
});

test('BV-STEM-3: "ed" is stripped only from words longer than 4 letters', () => {
  assert.strictEqual(stem('baked'), 'bak');
  assert.strictEqual(stem('bred'), 'bred');
});

test('BV-STEM-4: "es" is stripped only from words longer than 3 letters', () => {
  assert.strictEqual(stem('games'), 'gam');
  assert.strictEqual(stem('toes'), 'to');
  assert.strictEqual(stem('yes'), 'yes');
});

test('BV-STEM-5: a final "s" is stripped from words longer than 3 letters, but not "ss"', () => {
  assert.strictEqual(stem('books'), 'book');
  assert.strictEqual(stem('cats'), 'cat');
  assert.strictEqual(stem('bus'), 'bus');
  assert.strictEqual(stem('class'), 'class');
});

test('BV-STEM-6: a doubled final consonant is undoubled ("running" -> "run"), except l, s, z', () => {
  assert.strictEqual(stem('running'), 'run');
  assert.strictEqual(stem('swimming'), 'swim');
  assert.strictEqual(stem('jazz'), 'jazz');
  assert.strictEqual(stem('spell'), 'spell');
  assert.strictEqual(stem('egg'), 'egg', 'three letters: too short to undouble');
  assert.strictEqual(stem('runs'), 'run');
});

test('TS-MAT-1: tokenize lowercases, drops punctuation, apostrophes and stopwords', () => {
  assert.deepStrictEqual(tokenize("I'm REALLY into Rock'n'Roll!!!"), ['rocknroll']);
  assert.deepStrictEqual(tokenize('  studying   calculus  '), ['studying', 'calculus']);
  assert.deepStrictEqual(tokenize(null), []);
  assert.deepStrictEqual(tokenize(undefined), []);
  assert.deepStrictEqual(tokenize(42), ['42']);
});

test('TS-MAT-2 [single]: text with nothing meaningful never matches anything', () => {
  for (const empty of ['', '   ', 'i am just doing it right now', '!!! ???', '🙂🙂']) {
    assert.strictEqual(s(empty, 'coding a website'), 0, JSON.stringify(empty));
    assert.strictEqual(s(empty, empty), 0, `${JSON.stringify(empty)} with itself`);
  }
});

test('TS-MAT-3: identical wording (any case/punctuation) scores at least 0.95', () => {
  for (const t of ['studying calculus', 'Playing CHESS!', 'reading a book']) {
    assert.ok(s(t, t.toUpperCase() + '.') >= 0.95, t);
  }
});

test('TS-MAT-4: same category, different words, scores at least 0.3 + 0.4 x category overlap', () => {
  // gym / yoga share only the fitness category.
  const a = analyze('gym'), b = analyze('yoga');
  assert.deepStrictEqual([...a.categories], ['fitness']);
  assert.ok(score(a, b) >= 0.7 - 1e-9);
  assert.ok(s('baking bread', 'cooking dinner') >= 0.5);
});

test('TS-MAT-5: different categories with no shared words fall below the match threshold', () => {
  for (const [a, b] of [['playing valorant', 'baking a cake'], ['reading a novel', 'going to the gym'], ['meditating', 'doing my taxes spreadsheet']]) {
    assert.ok(s(a, b) < MIN_SCORE, `${a} / ${b} = ${s(a, b)}`);
  }
});

test('TS-MAT-6: a one-letter typo in a long word still lands in the right category', () => {
  assert.ok(analyze('progamming').categories.has('coding'));
  assert.ok(analyze('studyng').categories.has('studying'));
  assert.ok(s('progamming in javascript', 'programming') >= 0.5);
});

test('TS-MAT-7: very long input is handled and still matches its topic', () => {
  const long = 'coding '.repeat(500) + 'a react website';
  assert.ok(s(long, 'programming') >= 0.5);
});

test('D3 / TS-MAT-8: identical wording in a non-Latin script scores at least 0.95', () => {
  for (const t of ['日本語の勉強', 'читаю книгу', 'أقرأ كتابا', 'ders çalışıyorum', 'μαθαίνω κιθάρα']) {
    assert.ok(s(t, t) >= 0.95, `${t}: ${s(t, t)}`);
  }
});

test('D3 / TS-MAT-9: letters with diacritics are kept, not split into fragments', () => {
  assert.deepStrictEqual(tokenize('satranç oynuyorum'), ['satranç', 'oynuyorum']);
  assert.deepStrictEqual(tokenize('Café crème'), ['café', 'crème']);
  // Leftover fragments ("ık") used to make unrelated Turkish phrases look similar.
  assert.ok(s('ışık tasarımı', 'şık elbise') < MIN_SCORE, `scored ${s('ışık tasarımı', 'şık elbise')}`);
});

test('score is the better of the word score and the meaning score', () => {
  const a = analyze('playing chess'), b = analyze('cooking dinner');
  assert.strictEqual(semantic(a, b), 0, 'no vectors: no meaning score');
  a.vec = Float32Array.from([1, 0]);
  b.vec = Float32Array.from([1, 0]);
  assert.strictEqual(semantic(a, b), 1, 'cosine 1 maps to 1');
  assert.strictEqual(score(a, b), 1);
  b.vec = Float32Array.from([0.25, Math.sqrt(1 - 0.0625)]); // cosine 0.25 = SEMANTIC_LOW
  assert.strictEqual(semantic(a, b), 0);
  b.vec = Float32Array.from([0.5, Math.sqrt(0.75)]); // cosine 0.5: half-way between LOW and HIGH
  assert.ok(Math.abs(semantic(a, b) - 0.5) < 1e-6);
  b.vec = Float32Array.from([0.75, Math.sqrt(1 - 0.5625)]); // cosine 0.75 = SEMANTIC_HIGH
  assert.ok(Math.abs(semantic(a, b) - 1) < 1e-6);
  assert.strictEqual(score(a, b), Math.max(lexical(a, b), semantic(a, b)));
});
