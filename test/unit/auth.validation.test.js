// Unit tests for the account validation rules in auth.js (requirements FR1, SR1, SR5).
// Boundary-value analysis: each limit is tested just below, on, and just above (BV-AUTH-n).
// Spec: docs/test-specs/registration-boundaries.md
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert');
const auth = require('../../auth');

const { validateRegistration, validateProfile, passwordProblem, parseDob, parseCookies, validAvatar, ageOn, displayName } = auth;

// A valid registration on a fixed "today", so age boundaries don't drift with the calendar.
const TODAY = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const yearsAgo = (n, dayShift = 0) => {
  const d = new Date(Date.UTC(TODAY.getUTCFullYear() - n, TODAY.getUTCMonth(), TODAY.getUTCDate() + dayShift));
  return ymd(d);
};
const valid = (o = {}) => ({
  firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', password: 'abcdefg1',
  dateOfBirth: '1990-01-01', gender: 'woman', acceptTerms: true, ...o,
});
const errorsFor = (o) => validateRegistration(valid(o)).errors;

test('a fully valid registration has no errors and is normalised', () => {
  const { errors, value } = validateRegistration(valid({ firstName: '  Ada   Mae ', email: ' ADA@Example.COM ' }));
  assert.deepStrictEqual(errors, {});
  assert.strictEqual(value.firstName, 'Ada Mae');
  assert.strictEqual(value.email, 'ada@example.com');
});

test('BV-AUTH-1: names are 1..50 characters', () => {
  assert.ok(errorsFor({ firstName: '' }).firstName);
  assert.ok(!errorsFor({ firstName: 'A' }).firstName);
  assert.ok(!errorsFor({ firstName: 'a'.repeat(50) }).firstName);
  assert.ok(errorsFor({ firstName: 'a'.repeat(51) }).firstName);
  assert.ok(errorsFor({ lastName: 'b'.repeat(51) }).lastName);
});

test('names: letters of any script plus apostrophe, hyphen, dot and space; must start with a letter', () => {
  for (const ok of ["O'Neil", 'Anne-Marie', 'J. R.', 'Çağla', 'Zoë', 'Łukasz', '李']) assert.ok(!errorsFor({ firstName: ok }).firstName, ok);
  for (const bad of ['-Anne', "'Neil", 'R2D2', '<b>', 'a@b', 42, null]) assert.ok(errorsFor({ firstName: bad }).firstName, String(bad));
});

test('BV-AUTH-2: passwords are 8..128 characters with a letter and a digit', () => {
  assert.ok(passwordProblem('abcdef1')); // 7
  assert.strictEqual(passwordProblem('abcdefg1'), null); // 8
  assert.strictEqual(passwordProblem('a'.repeat(127) + '1'), null); // 128
  assert.match(passwordProblem('a'.repeat(128) + '1'), /at most 128/); // 129
  assert.match(passwordProblem('abcdefgh'), /letter and one number/);
  assert.match(passwordProblem('12345678'), /letter and one number/);
  for (const notString of [undefined, null, 12345678, ['abcdefg1']]) assert.ok(passwordProblem(notString));
});

test('BV-AUTH-3: email needs a 2+ letter TLD and at most 254 characters', () => {
  assert.ok(!errorsFor({ email: 'a@b.co' }).email);
  assert.ok(errorsFor({ email: 'a@b.c' }).email);
  const local = 'x'.repeat(64);
  const at254 = `${local}@${'d'.repeat(254 - 64 - 1 - 4)}.com`;
  assert.strictEqual(at254.length, 254);
  assert.ok(!errorsFor({ email: at254 }).email);
  assert.ok(errorsFor({ email: 'y' + at254 }).email, '255 characters');
  for (const bad of ['plain', 'a b@c.com', '@b.com', 'a@', 'a@@b.com', '']) assert.ok(errorsFor({ email: bad }).email, bad);
});

test('BV-AUTH-4: you must be 18 today (not tomorrow) and at most 120', () => {
  assert.ok(!errorsFor({ dateOfBirth: yearsAgo(18) }).dateOfBirth, '18th birthday today');
  assert.match(errorsFor({ dateOfBirth: yearsAgo(18, +1) }).dateOfBirth, /at least 18/, '18th birthday tomorrow');
  assert.ok(!errorsFor({ dateOfBirth: yearsAgo(120) }).dateOfBirth);
  assert.ok(errorsFor({ dateOfBirth: yearsAgo(121) }).dateOfBirth);
  assert.match(errorsFor({ dateOfBirth: yearsAgo(-1) }).dateOfBirth, /at least 18/, 'a future date');
});

test('dates must be real calendar dates in YYYY-MM-DD', () => {
  assert.ok(parseDob('1996-02-29'), 'leap day in a leap year');
  for (const bad of ['1995-02-29', '2001-02-31', '1995-13-01', '1995-6-15', '15/06/1995', '', null, 19950615]) {
    assert.strictEqual(parseDob(bad), null, String(bad));
  }
});

test('age on a birthday boundary, including a 29 February birthday', () => {
  const on = (s) => new Date(`${s}T12:00:00Z`);
  assert.strictEqual(ageOn(new Date('2008-10-01T00:00:00Z'), on('2026-10-01')), 18);
  assert.strictEqual(ageOn(new Date('2008-10-01T00:00:00Z'), on('2026-09-30')), 17);
  assert.strictEqual(ageOn(new Date('2008-02-29T00:00:00Z'), on('2026-02-28')), 17);
  assert.strictEqual(ageOn(new Date('2008-02-29T00:00:00Z'), on('2026-03-01')), 18);
});

test('gender is optional but must come from the list; terms must be exactly true', () => {
  for (const g of ['woman', 'man', 'nonbinary', 'other', 'prefer_not', '', null, undefined]) assert.ok(!errorsFor({ gender: g }).gender, String(g));
  assert.ok(errorsFor({ gender: 'robot' }).gender);
  assert.ok(errorsFor({ gender: { toString: {} } }).gender, 'D6: an object is not a gender (and must not throw)');
  assert.ok(errorsFor({ gender: ['woman'] }).gender);
  assert.ok(errorsFor({ acceptTerms: 'true' }).acceptTerms);
  assert.ok(errorsFor({ acceptTerms: false }).acceptTerms);
});

test('BV-AUTH-5: avatars are png/jpeg/webp/gif data URLs of at most 300 KB', () => {
  const head = 'data:image/png;base64,';
  const of = (n) => head + 'A'.repeat(n - head.length);
  assert.ok(validAvatar(of(auth.MAX_AVATAR_BYTES)));
  assert.ok(!validAvatar(of(auth.MAX_AVATAR_BYTES + 1)));
  for (const type of ['jpeg', 'webp', 'gif']) assert.ok(validAvatar(`data:image/${type};base64,AAAA`));
  for (const bad of ['data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA', 'https://x/y.png', 'data:image/png;base64,<script>', 42]) {
    assert.ok(!validAvatar(bad), String(bad));
  }
});

test('BV-AUTH-6: profile limits: bio 200, interests 5 (deduped, #-stripped, 24 chars), languages 5', () => {
  assert.ok(!validateProfile({ bio: 'b'.repeat(200) }).errors.bio);
  assert.ok(validateProfile({ bio: 'b'.repeat(201) }).errors.bio);
  const five = ['chess', '#Chess', 'go', 'poker', 'bridge', 'CHESS', 'x'.repeat(30)];
  const { value } = validateProfile({ interests: five });
  assert.deepStrictEqual(JSON.parse(value.interests), ['chess', 'go', 'poker', 'bridge', 'x'.repeat(24)]);
  assert.ok(validateProfile({ interests: ['a', 'b', 'c', 'd', 'e', 'f'] }).errors.interests);
  assert.ok(!validateProfile({ languages: ['en', 'tr', 'fr', 'de', 'es'] }).errors.languages);
  assert.ok(validateProfile({ languages: ['en', 'tr', 'fr', 'de', 'es', 'it'] }).errors.languages);
  assert.ok(validateProfile({ languages: ['xx'] }).errors.languages);
});

test('profile text is cleaned of control characters and cut to length; unknown values refused', () => {
  const { errors, value } = validateProfile({ city: 'Edin\u0000burgh\n' + 'x'.repeat(100), timezone: 'Europe/London', country: 'GB', gender: '' });
  assert.deepStrictEqual(errors, {});
  assert.strictEqual(value.city.length, 60);
  assert.ok(value.city.startsWith('Edin burgh'));
  assert.strictEqual(value.gender, null);
  assert.ok(validateProfile({ timezone: 'Mars/Olympus' }).errors.timezone);
  assert.ok(validateProfile({ country: 'XX' }).errors.country);
  assert.deepStrictEqual(validateProfile({}), { errors: {}, value: {} }, 'only fields present are touched');
});

test('cookies: every cookie parsed, malformed values skipped (D1)', () => {
  assert.deepStrictEqual(parseCookies('a=1; b=hello%20world;c'), { a: '1', b: 'hello world' });
  assert.deepStrictEqual(parseCookies('bad=%E0%A4%A; good=1'), { good: '1' });
  assert.deepStrictEqual(parseCookies(undefined), {});
  assert.strictEqual(auth.sessionFromCookieHeader('connecto_sid=%'), null);
});

test('strangers see first name and last initial only', () => {
  assert.strictEqual(displayName({ first_name: 'ada', last_name: 'lovelace' }), 'ada L.');
  assert.strictEqual(displayName({ first_name: 'Zoë', last_name: 'çelik' }), 'Zoë Ç.');
});
