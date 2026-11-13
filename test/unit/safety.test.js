// Unit tests for safety.js (reports, auto-suspension, blocks), requirements FR7, SR2, SR3.
// Test cases come from the category-partition specification in docs/test-specs/report-category-partition.md
// (TS-REP-n ids in the test names). The database is an in-memory SQLite (test/support/db-fixture.js).
process.env.ADMIN_EMAILS = 'admin@example.com';
const test = require('node:test');
const assert = require('node:assert');
const { db, makeUser, atTime } = require('../support/db-fixture');
const safety = require('../../safety');
const { outbox } = require('../../mail');

const HOUR = 60 * 60 * 1000;
const report = (reporterId, reportedId, extra = {}) =>
  safety.createReport({ reporterId, reportedId, reason: 'spam', context: 'match', ...extra });
const reportsAbout = (id) => db.prepare('SELECT * FROM reports WHERE reported_id = ?').all(id);
const banned = (id) => db.prepare('SELECT banned_at, ban_reason FROM users WHERE id = ?').get(id);

test('TS-REP-1: every listed reason is accepted', () => {
  for (const reason of Object.keys(safety.REASONS)) {
    // A fresh person each time: three reports about one person would (correctly) suspend them.
    assert.deepStrictEqual(report(makeUser(), makeUser(), { reason }), { ok: true, autoSuspended: false }, reason);
  }
});

test('D2 / TS-REP-2 [error]: unknown, missing and non-string reasons are refused', () => {
  const [a, b] = [makeUser(), makeUser()];
  for (const reason of ['', 'SPAM', 'rude', undefined, null, 42, ['spam'], { spam: 1 }]) {
    assert.match(report(a, b, { reason }).error || '', /Choose a reason/, String(reason));
  }
  assert.strictEqual(reportsAbout(b).length, 0);
});

test('D2 / TS-REP-3 [error]: inherited object keys are not valid reasons', () => {
  const [a, b] = [makeUser(), makeUser()];
  for (const reason of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.match(report(a, b, { reason }).error || '', /Choose a reason/, reason);
  }
  assert.strictEqual(reportsAbout(b).length, 0, 'nothing stored');
});

test('TS-REP-4 [error]: you cannot report yourself', () => {
  const a = makeUser();
  assert.match(report(a, a).error, /report yourself/);
});

test('TS-REP-5: details are whitespace-collapsed, trimmed and cut at 500 characters', () => {
  const [a, b, c, d] = [makeUser(), makeUser(), makeUser(), makeUser()];
  report(a, b, { details: '  line one\n\n\tline   two  ' });
  assert.strictEqual(reportsAbout(b)[0].details, 'line one line two');
  report(a, c, { details: 'x'.repeat(501) });
  assert.strictEqual(reportsAbout(c)[0].details.length, 500);
  report(a, d, { details: '   ' });
  assert.strictEqual(reportsAbout(d)[0].details, null, 'blank details stored as NULL');
});

test('TS-REP-6: a second open report about the same person updates the first (one per pair)', () => {
  const [a, b] = [makeUser(), makeUser()];
  report(a, b, { reason: 'spam', details: 'first' });
  report(a, b, { reason: 'harassment', details: 'second' });
  const rows = reportsAbout(b);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].reason, 'harassment');
  assert.strictEqual(rows[0].details, 'second');
});

test('TS-REP-7: the transcript keeps only the last 100 messages', () => {
  const [a, b] = [makeUser(), makeUser()];
  const transcript = Array.from({ length: 130 }, (_, i) => ({ name: 'x', text: `m${i}`, at: i }));
  report(a, b, { context: 'call', transcript });
  const kept = JSON.parse(reportsAbout(b)[0].transcript);
  assert.strictEqual(kept.length, 100);
  assert.strictEqual(kept[0].text, 'm30');
  assert.strictEqual(kept.at(-1).text, 'm129');
});

test('TS-REP-8 (boundary): the 10th report in an hour is accepted, the 11th refused, and the limit resets after an hour', async () => {
  const reporter = makeUser();
  const t0 = Date.UTC(2026, 10, 1, 12);
  await atTime(t0, () => {
    for (let i = 0; i < 10; i++) assert.ok(report(reporter, makeUser()).ok, `report ${i + 1}`);
    assert.match(report(reporter, makeUser()).error, /a lot of reports/);
  });
  await atTime(t0 + HOUR + 1, () => assert.ok(report(reporter, makeUser()).ok, 'window has passed'));
});

test('TS-REP-9 (boundary): reports from 2 people do not suspend; the 3rd distinct person within 24h does', () => {
  const target = makeUser();
  const before = outbox.length;
  assert.strictEqual(report(makeUser(), target).autoSuspended, false);
  assert.strictEqual(report(makeUser(), target).autoSuspended, false);
  assert.strictEqual(banned(target).banned_at, null);
  assert.strictEqual(report(makeUser(), target).autoSuspended, true);
  assert.ok(banned(target).banned_at);
  assert.match(banned(target).ban_reason, /reported by 3 people/);
  const mails = outbox.slice(before).filter((m) => m.to === 'admin@example.com');
  assert.strictEqual(mails.length, 3, 'admins are emailed about each new report');
  assert.match(mails.at(-1).subject, /^\[Auto-suspended\]/);
});

test('TS-REP-10: the same person reporting twice counts once towards auto-suspension', () => {
  const target = makeUser();
  const a = makeUser();
  report(a, target);
  report(a, target, { reason: 'hate' });
  report(makeUser(), target);
  assert.strictEqual(banned(target).banned_at, null);
});

test('TS-REP-11 (boundary): reports older than 24 hours do not count towards auto-suspension', async () => {
  const target = makeUser();
  const t0 = Date.UTC(2026, 10, 2, 12);
  await atTime(t0, () => { report(makeUser(), target); report(makeUser(), target); });
  await atTime(t0 + 24 * HOUR + 1, () => {
    assert.strictEqual(report(makeUser(), target).autoSuspended, false);
  });
  assert.strictEqual(banned(target).banned_at, null);
});

test('TS-REP-12: suspension deletes the account\'s sessions and calls the realtime handler once', () => {
  const target = makeUser();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(`h${target}`, target, 0, Date.now() + HOUR);
  const kicked = [];
  safety.setSuspendHandler((id) => kicked.push(id));
  for (let i = 0; i < 4; i++) report(makeUser(), target);
  assert.deepStrictEqual(kicked, [target], 'already-suspended accounts are not suspended again');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(target).n, 0);
  safety.setSuspendHandler(() => {});
});

test('blocks are symmetric, self-blocks are ignored, and unblocking keeps a reverse block in force', () => {
  const [a, b, c] = [makeUser(), makeUser(), makeUser()];
  safety.block(a, a);
  assert.strictEqual(safety.isBlocked(a, a), false);
  safety.block(a, b);
  assert.ok(safety.isBlocked(a, b) && safety.isBlocked(b, a), 'both directions');
  assert.strictEqual(safety.isBlocked(a, c), false);
  safety.block(b, a); // both blocked each other
  safety.unblock(a, b);
  assert.ok(safety.isBlocked(a, b), 'b still blocks a');
  safety.unblock(b, a);
  assert.strictEqual(safety.isBlocked(a, b), false);
});

test('admins are verified, unsuspended accounts listed in ADMIN_EMAILS (case-insensitive)', () => {
  const user = (o) => ({ email: 'Admin@Example.com', email_verified_at: 1, banned_at: null, ...o });
  assert.strictEqual(safety.isAdmin(user()), true);
  assert.strictEqual(safety.isAdmin(user({ email_verified_at: null })), false);
  assert.strictEqual(safety.isAdmin(user({ banned_at: 1 })), false);
  assert.strictEqual(safety.isAdmin(user({ email: 'someone@example.com' })), false);
  assert.strictEqual(safety.isAdmin(null), false);
});
