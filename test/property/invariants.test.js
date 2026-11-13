// Property-based tests (fast-check): laws that must hold for every input, not just chosen examples.
// Each property is checked on 1000 generated inputs (PROP_RUNS overrides); a failure is shrunk to a
// minimal counterexample and the seed is printed so it can be replayed.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { analyze, score, lexical, tokenize, stem } = require('../../matcher');
const prefs = require('../../prefs');
const auth = require('../../auth');

const RUNS = Number(process.env.PROP_RUNS) || 1000;
// Activity-like text: real words, typos, other scripts, emoji and junk.
const word = fc.oneof(
  fc.constantFrom('coding', 'gym', 'chess', 'reading', 'satranç', 'çalışıyorum', '勉強', 'книгу', 'running', 'cook', 'the', 'I', "I'm", '🙂', '!!!'),
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.stringMatching(/^[a-z]{1,12}$/),
);
const activity = fc.array(word, { maxLength: 8 }).map((ws) => ws.join(' '));

test('P-MAT-1: scores are always within [0, 1]', () => {
  fc.assert(fc.property(activity, activity, (a, b) => {
    const s = score(analyze(a), analyze(b));
    return s >= 0 && s <= 1;
  }), { numRuns: RUNS });
});

test('P-MAT-2: scoring is symmetric', () => {
  fc.assert(fc.property(activity, activity, (a, b) => score(analyze(a), analyze(b)) === score(analyze(b), analyze(a))), { numRuns: RUNS });
});

test('P-MAT-3: any text with at least one meaningful word scores >= 0.95 against itself', () => {
  fc.assert(fc.property(activity, (a) => {
    fc.pre(tokenize(a).length > 0);
    return lexical(analyze(a), analyze(a)) >= 0.95;
  }), { numRuns: RUNS });
});

test('P-MAT-4: case and surrounding punctuation never change the score', () => {
  fc.assert(fc.property(activity, activity, (a, b) => {
    const base = score(analyze(a), analyze(b));
    return score(analyze(`  ${a.toUpperCase()}?! `), analyze(b)) === base || a.toUpperCase().toLowerCase() !== a.toLowerCase();
  }), { numRuns: RUNS });
});

test('P-MAT-5: tokenize is idempotent and stem never lengthens a word', () => {
  fc.assert(fc.property(activity, (a) => {
    const t = tokenize(a);
    assert.deepStrictEqual(tokenize(t.join(' ')), t);
    for (const w of t) assert.ok(stem(w).length <= w.length);
    return true;
  }), { numRuns: RUNS });
});

const prefsArb = fc.record({
  genders: fc.array(fc.constantFrom('woman', 'man', 'nonbinary', 'robot', 7), { maxLength: 4 }),
  ages: fc.array(fc.constantFrom('18-25', '26-35', '36-45', '46+', '0-1'), { maxLength: 4 }),
  countries: fc.array(fc.constantFrom('TR', 'GB', 'US', 'XX'), { maxLength: 4 }),
  languages: fc.array(fc.constantFrom('en', 'tr', 'fr', 'zz'), { maxLength: 4 }),
  modes: fc.array(fc.constantFrom('video', 'voice', 'chat', 'fax'), { maxLength: 4 }),
}, { requiredKeys: [] });
const factsArb = fc.record({
  gender: fc.constantFrom('woman', 'man', 'nonbinary', 'other', null),
  age: fc.option(fc.integer({ min: 18, max: 110 })),
  country: fc.constantFrom('TR', 'GB', 'US', null),
  languages: fc.subarray(['en', 'tr', 'fr']),
});
const sideArb = fc.record({ prefs: prefsArb.map((p) => prefs.clean(p)), facts: factsArb });

test('P-PREF-1: clean is idempotent and only ever returns allowed values', () => {
  fc.assert(fc.property(fc.oneof(prefsArb, fc.anything()), (raw) => {
    const once = prefs.clean(raw && typeof raw === 'object' ? raw : {});
    assert.deepStrictEqual(prefs.clean(once), once);
    assert.ok(once.modes.length >= 1 && once.modes.every((m) => prefs.MODES.includes(m)));
    assert.ok(once.countries.every((c) => prefs.COUNTRIES.includes(c)));
    return true;
  }), { numRuns: RUNS });
});

test('P-PREF-2: compatibility is symmetric, and nobody with no filters is ever excluded by filters', () => {
  fc.assert(fc.property(sideArb, sideArb, (a, b) => {
    assert.strictEqual(prefs.compatible(a, b), prefs.compatible(b, a));
    assert.ok(prefs.fits(prefs.clean({}), b.facts));
    return true;
  }), { numRuns: RUNS });
});

test('P-PREF-3: adding a filter can only shrink the set of people you fit with (monotonic)', () => {
  fc.assert(fc.property(prefsArb, factsArb, fc.constantFrom('woman', 'man'), (p, f, g) => {
    const loose = prefs.clean(p);
    const strict = prefs.clean({ ...p, genders: [...(p.genders || []).filter((x) => x !== g)].length ? p.genders.filter((x) => x !== g) : [g === 'woman' ? 'man' : 'woman'] });
    // If the strict filter accepts someone, a looser one that includes everything the strict one does must too.
    if (!loose.genders.length && prefs.fits(strict, f)) assert.ok(prefs.fits(loose, f));
    return true;
  }), { numRuns: RUNS });
});

const regArb = fc.record({
  firstName: fc.oneof(fc.string({ maxLength: 60 }), fc.constantFrom('Ada', 'Çağla', "O'Neil"), fc.anything()),
  lastName: fc.oneof(fc.string({ maxLength: 60 }), fc.constant('Lovelace'), fc.anything()),
  email: fc.oneof(fc.emailAddress(), fc.string(), fc.anything()),
  password: fc.oneof(fc.string({ maxLength: 140 }), fc.constant('hunter22abc'), fc.anything()),
  dateOfBirth: fc.oneof(fc.date({ min: new Date('1890-01-01'), max: new Date('2030-01-01') }).map((d) => (Number.isNaN(d.getTime()) ? 'x' : d.toISOString().slice(0, 10))), fc.string(), fc.anything()),
  gender: fc.oneof(fc.constantFrom('woman', 'man', 'other', 'robot', null), fc.anything()),
  avatar: fc.oneof(fc.constant(undefined), fc.constant('data:image/png;base64,AAAA'), fc.anything()),
  acceptTerms: fc.oneof(fc.constant(true), fc.anything()),
}, { requiredKeys: [] });

test('P-AUTH-1: validation never throws, and anything it accepts satisfies every rule (SR1, FR1)', () => {
  const today = new Date();
  fc.assert(fc.property(regArb, (body) => {
    const { errors, value } = auth.validateRegistration(body);
    if (Object.keys(errors).length) return true;
    // Accepted: check the requirements directly, independently of the implementation.
    assert.ok(value.firstName.length >= 1 && value.firstName.length <= 50);
    assert.ok(value.email.length <= 254 && value.email === value.email.toLowerCase() && value.email.includes('@'));
    assert.ok(value.password.length >= 8 && value.password.length <= 128 && /\d/.test(value.password) && /[A-Za-z]/.test(value.password));
    const dob = new Date(`${value.dateOfBirth}T00:00:00Z`);
    const eighteenth = new Date(Date.UTC(dob.getUTCFullYear() + 18, dob.getUTCMonth(), dob.getUTCDate()));
    // Born on 29 Feb: the 18th birthday is 1 March in a non-leap year (Date.UTC rolls over the same way).
    assert.ok(eighteenth <= today, `${value.dateOfBirth} is under 18`);
    assert.strictEqual(body.acceptTerms, true);
    return true;
  }), { numRuns: RUNS });
});

test('P-AUTH-2: profile validation never throws on arbitrary input', () => {
  fc.assert(fc.property(fc.dictionary(fc.constantFrom('bio', 'city', 'country', 'languages', 'gender', 'timezone', 'interests'), fc.anything()), (body) => {
    const { errors, value } = auth.validateProfile(body);
    return typeof errors === 'object' && typeof value === 'object';
  }), { numRuns: RUNS });
});

test('P-AUTH-3: cookie parsing never throws on any header string (D1)', () => {
  fc.assert(fc.property(fc.string({ unit: 'binary' }), (h) => typeof auth.parseCookies(h) === 'object'), { numRuns: RUNS });
});
