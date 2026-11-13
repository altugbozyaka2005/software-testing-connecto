// Tests added after the first mutation run (reports/test-runs/stryker-run-1.txt, 56.8%): each MK-n test kills
// surviving mutants that showed a real weakness in the earlier tests (docs/evaluation.md section 3).
// Weaknesses found: one-sided time-window tests, no exact score oracles (only thresholds, hidden by a clamp),
// a tautological oracle (DEFAULTS compared with itself), untested regex anchors and normalised values.
process.env.ADMIN_EMAILS = 'admin@example.com';
const test = require('node:test');
const assert = require('node:assert');
const { db, makeUser, atTime } = require('../support/db-fixture');
const matcher = require('../../matcher');
const prefs = require('../../prefs');
const safety = require('../../safety');
const bg = require('../../background');
const chat = require('../../chat');
const friends = require('../../friends');
const auth = require('../../auth');
const { iceServersFor } = require('../../turn');
const { outbox } = require('../../mail');

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 20, 12);

// ---- matcher: exact oracles, computed by hand ----

test('MK-1: exact word score with no shared category: 0.35 x keyword cosine + 0.2 x trigram Jaccard', () => {
  // keywords {xylo,quartz} vs {xylo,zebra}: cosine 1/2; trigrams 5 shared of 12 + 11 -> 5/18; no category.
  const s = matcher.lexical(matcher.analyze('xylo quartz'), matcher.analyze('xylo zebra'));
  assert.ok(Math.abs(s - (0.35 * 0.5 + 0.2 * (5 / 18))) < 1e-12, String(s));
});

test('MK-2: the same-category floor is exactly 0.3 + 0.4 x category overlap', () => {
  // gym {fitness} vs workout {fitness, working}: overlap 1/2, no shared words or trigrams.
  assert.strictEqual(matcher.lexical(matcher.analyze('gym'), matcher.analyze('workout')), 0.5);
});

test('MK-3: category triggers: exact word, a word starting with a 4-letter trigger, a 4-letter prefix of a trigger', () => {
  assert.deepStrictEqual([...matcher.analyze('codebase').categories], ['coding']); // starts with "code"
  assert.deepStrictEqual([...matcher.analyze('prog').categories], ['coding']); // prefix of "program"
  assert.deepStrictEqual([...matcher.analyze('pro').categories], [], 'three letters are too short to be a prefix');
  assert.deepStrictEqual([...matcher.analyze('ding').categories], [], 'a suffix of a trigger ("coding") does not count');
});

test('MK-4: punctuation separates words; a meaning score needs vectors on both sides', () => {
  assert.deepStrictEqual(matcher.tokenize('coding,gaming'), ['coding', 'gaming']);
  const a = matcher.analyze('x'), b = matcher.analyze('y');
  a.vec = Float32Array.from([1, 0]);
  assert.strictEqual(matcher.semantic(a, b), 0);
  assert.strictEqual(matcher.semantic(b, a), 0);
});

// ---- prefs: literal oracles instead of comparing the module with itself ----

test('MK-5: defaults are "anyone" with every mode (literal oracle)', () => {
  const expected = { genders: [], ages: [], countries: [], languages: [], modes: ['video', 'voice', 'chat'] };
  assert.deepStrictEqual(prefs.parse(null), expected);
  assert.deepStrictEqual(prefs.parse(''), expected);
  assert.deepStrictEqual({ ...prefs.DEFAULTS }, expected);
});

test('MK-6: ages around a birthday in the same month, and filters with unknown or matching facts', () => {
  assert.strictEqual(prefs.ageFrom('2000-11-20', new Date('2026-11-19T12:00:00Z')), 25);
  assert.strictEqual(prefs.ageFrom('2000-11-20', new Date('2026-11-20T12:00:00Z')), 26);
  assert.strictEqual(prefs.ageFrom('2000-11-20', new Date('2026-12-01T12:00:00Z')), 26);
  const f = (o) => ({ gender: null, age: null, country: null, languages: [], ...o });
  assert.strictEqual(prefs.fits(prefs.clean({ ages: ['18-25'] }), f({ age: 20 })), true);
  assert.strictEqual(prefs.fits(prefs.clean({ ages: ['18-25'] }), f({ age: null })), false);
  assert.strictEqual(prefs.fits(prefs.clean({ languages: ['tr'] }), f({ languages: ['en', 'tr'] })), true);
  assert.strictEqual(prefs.fits(prefs.clean({ languages: ['tr'] }), f({ languages: ['en'] })), false);
});

// ---- time windows tested on BOTH sides ----

test('MK-7: auto-suspension counts reports from the last 24 h (3rd report 23 h later still suspends)', async () => {
  const target = makeUser();
  await atTime(T0, () => { safety.createReport({ reporterId: makeUser(), reportedId: target, reason: 'spam', context: 'match' }); });
  await atTime(T0 + HOUR, () => { safety.createReport({ reporterId: makeUser(), reportedId: target, reason: 'spam', context: 'match' }); });
  const r = await atTime(T0 + 23 * HOUR, () => safety.createReport({ reporterId: makeUser(), reportedId: target, reason: 'spam', context: 'match' }));
  assert.strictEqual(r.autoSuspended, true);
});

test('MK-8: the report limit window is a full hour (10 reports spread over 59 minutes still block the 11th)', async () => {
  const reporter = makeUser();
  for (let i = 0; i < 10; i++) await atTime(T0 + i * 6 * 60e3, () => safety.createReport({ reporterId: reporter, reportedId: makeUser(), reason: 'spam', context: 'match' }));
  const r = await atTime(T0 + 59 * 60e3, () => safety.createReport({ reporterId: reporter, reportedId: makeUser(), reason: 'spam', context: 'match' }));
  assert.match(r.error, /a lot of reports/);
});

test('MK-9: the daily connect-request limit lasts 24 h, then resets', async () => {
  const a = makeUser();
  await atTime(T0, () => { for (let i = 0; i < 20; i++) bg.request(a, makeUser(), 'x'); });
  await atTime(T0 + 23 * HOUR, () => assert.match(bg.request(a, makeUser(), 'x').error, /a lot of requests/));
  await atTime(T0 + DAY + 1, () => assert.strictEqual(bg.request(a, makeUser(), 'x').status, 'pending'));
});

test('MK-10: "talked recently" lasts exactly 7 days', async () => {
  const [a, b] = [makeUser(), makeUser()];
  await atTime(T0, () => { bg.request(a, b, 'x'); bg.settle(a, b); });
  await atTime(T0 + 7 * DAY - 1, () => assert.strictEqual(bg.talkedRecently(a, b), true));
  await atTime(T0 + 7 * DAY, () => assert.strictEqual(bg.talkedRecently(a, b), false));
});

test('MK-11: notification emails are throttled to one per 3 hours, except urgent ones', async () => {
  const a = makeUser({ email: `notify${Date.now()}@example.com` });
  const mine = () => outbox.filter((m) => m.to.startsWith('notify')).length;
  const before = mine();
  await atTime(T0, () => bg.notify(a, 'request', { name: 'X', activity: 'chess' }));
  await atTime(T0 + 3 * HOUR - 1, () => bg.notify(a, 'request', { name: 'X', activity: 'chess' }));
  await atTime(T0 + 3 * HOUR - 1, () => bg.notify(a, 'reminder', { name: 'X', at: T0 + 4 * HOUR, urgent: true }));
  await atTime(T0 + 3 * HOUR, () => bg.notify(a, 'request', { name: 'X', activity: 'chess' }));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(mine() - before, 3, 'first, urgent, and the one after 3 h');
  bg.setNotify(a, false);
  await atTime(T0 + 9 * HOUR, () => bg.notify(a, 'request', { name: 'X', activity: 'chess' }));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(mine() - before, 3, 'turned off');
});

test('MK-12: the DM burst window is 10 s (5 s later the 16th is still refused)', async () => {
  const [a, b] = [makeUser(), makeUser()];
  chat.connect(a, b);
  await atTime(T0, () => { for (let i = 0; i < 15; i++) chat.send(a, b, `m${i}`); });
  await atTime(T0 + 5e3, () => assert.match(chat.send(a, b, 'too soon').error, /too fast/));
});

// ---- boundaries the first suite missed ----

test('MK-13: exactly 3 proposed times are allowed and are sorted; picking at exactly "now" is allowed', async () => {
  const [a, b] = [makeUser(), makeUser()];
  let id;
  await atTime(T0, () => {
    id = bg.request(a, b, 'x').request.id;
    bg.respond(id, b, true);
    const times = [T0 + 3 * HOUR, T0 + HOUR, T0 + 2 * HOUR];
    assert.deepStrictEqual(JSON.parse(bg.propose(id, a, times).proposed_slots), [T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR]);
  });
  await atTime(T0 + HOUR, () => assert.strictEqual(bg.pick(id, b, T0 + HOUR).meeting_at, T0 + HOUR));
});

test('MK-14: a request answered by asking back returns the accepted request; forAccount lists only live ones', () => {
  const [a, b, c] = [makeUser(), makeUser(), makeUser()];
  bg.request(a, b, 'x');
  const r = bg.request(b, a, 'x');
  assert.strictEqual(r.request.status, 'accepted');
  assert.strictEqual(r.request.from_id, a);
  const declined = bg.request(c, a, 'y').request;
  bg.respond(declined.id, a, false);
  assert.deepStrictEqual(bg.forAccount(a).map((x) => x.status), ['accepted']);
  assert.strictEqual(bg.has(a), false);
  assert.ok(!bg.start(a, 'chess', 3).error);
  assert.strictEqual(bg.has(a), true);
});

test('MK-15: pairs are stored in id order whichever way round they are given', () => {
  const [low, high] = [makeUser(), makeUser()];
  chat.connect(high, low);
  assert.ok(chat.connectedSince(low, high) && chat.connectedSince(high, low));
  assert.deepStrictEqual({ ...db.prepare('SELECT user_a, user_b FROM connections WHERE user_a = ? OR user_b = ?').get(low, low) }, { user_a: low, user_b: high });
  chat.disconnect(high, low);
  assert.strictEqual(chat.isConnected(low, high), false);
  friends.request(high, low);
  friends.request(low, high);
  assert.deepStrictEqual({ ...db.prepare('SELECT user_a, user_b FROM friendships WHERE user_a = ?').get(low) }, { user_a: low, user_b: high });
  friends.remove(high, low);
  assert.strictEqual(friends.areFriends(low, high), false);
  friends.remove(makeUser(), makeUser()); // never friends: must not throw
  chat.disconnect(makeUser(), makeUser());
  safety.unblock(makeUser(), makeUser());
  assert.deepStrictEqual(chat.connectionIds(makeUser()), []);
});

test('MK-16: history has "more" only beyond 50; read flags, own-message flag and 120-char previews', () => {
  const [a, b] = [makeUser(), makeUser()];
  const ins = db.prepare('INSERT INTO messages (from_id, to_id, body, created_at, read_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < 50; i++) ins.run(b, a, `m${i}`, i, i < 10 ? 1 : null);
  const page = chat.history(a, b);
  assert.strictEqual(page.messages.length, 50);
  assert.strictEqual(page.more, false);
  assert.strictEqual(page.messages[0].read, true);
  assert.strictEqual(page.messages[49].read, false);
  ins.run(a, b, 'y'.repeat(300), 100, null);
  const sum = chat.summaries(a).get(b);
  assert.strictEqual(sum.last.mine, true);
  assert.strictEqual(sum.last.body.length, 120);
  assert.strictEqual(sum.unread, 40);
  assert.strictEqual(chat.summaries(b).get(a).last.mine, false);
});

test('MK-17: CR line endings are normalised too (\\r\\n and lone \\r)', () => {
  const [a, b] = [makeUser(), makeUser()];
  chat.connect(a, b);
  assert.strictEqual(chat.send(a, b, 'x\r\ny\rz').message.body, 'x\ny\nz');
});

// ---- safety: what admins are told ----

test('MK-18: the admin email names the reported person and the reason label; updates and no-admin setups send nothing', () => {
  const reported = makeUser({ first_name: 'Rhea', last_name: 'Stone' });
  const reporter = makeUser();
  const before = outbox.length;
  safety.createReport({ reporterId: reporter, reportedId: reported, reason: 'violence', context: 'match' });
  const mail = outbox.at(-1);
  assert.strictEqual(outbox.length - before, 1);
  assert.strictEqual(mail.subject, 'New report: Rhea Stone');
  assert.match(mail.text, /New report: Violence, threats or self-harm/);
  safety.createReport({ reporterId: reporter, reportedId: reported, reason: 'hate', context: 'match' });
  assert.strictEqual(outbox.length - before, 1, 'an update to an open report is not emailed again');
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = '';
  try {
    safety.createReport({ reporterId: makeUser(), reportedId: makeUser(), reason: 'spam', context: 'match', activity: 'chess' });
  } finally { process.env.ADMIN_EMAILS = saved; }
  assert.strictEqual(outbox.length - before, 1);
  assert.strictEqual(db.prepare('SELECT activity FROM reports ORDER BY id DESC').get().activity, 'chess');
  safety.createReport({ reporterId: makeUser(), reportedId: makeUser(), reason: 'spam', context: 'match' });
  assert.strictEqual(db.prepare('SELECT activity FROM reports ORDER BY id DESC').get().activity, null);
  assert.deepStrictEqual(Object.values(safety.REASONS).filter((v) => !v), [], 'every reason has a label');
});

// ---- auth: anchors, normalised values, token lifetimes ----

test('MK-19: patterns are anchored at both ends', () => {
  for (const bad of ['x1995-06-15', '1995-06-150']) assert.strictEqual(auth.parseDob(bad), null, bad);
  const err = (email) => auth.validateRegistration({ email }).errors.email;
  assert.ok(err('a@b.cc@d'), 'nothing after the domain');
  assert.ok(!auth.validAvatar('xdata:image/png;base64,AAAA'));
  assert.ok(!auth.validAvatar('data:image/png;base64,AAAA!'));
});

test('MK-20: registration and profile values are normalised (blank -> null, deduplicated, trimmed)', () => {
  const ok = { firstName: 'Ada', lastName: 'Byron', email: 'a@b.co', password: 'abcdefg1', dateOfBirth: '1990-01-01', acceptTerms: true };
  assert.strictEqual(auth.validateRegistration({ ...ok, gender: '' }).value.gender, null);
  assert.strictEqual(auth.validateRegistration({ ...ok, gender: 'man' }).value.gender, 'man');
  assert.strictEqual(auth.validateRegistration(ok).value.avatar, null);
  assert.strictEqual(auth.validateRegistration({ ...ok, password: 'abcdefg1 ' }).value.password, 'abcdefg1 ', 'passwords are not trimmed');
  assert.ok(auth.validateRegistration({ ...ok, lastName: '' }).errors.lastName);
  assert.ok(auth.validateRegistration({ ...ok, avatar: 'data:text/html;base64,AAAA' }).errors.avatar);
  const p = auth.validateProfile({ bio: '   ', country: '', timezone: '', gender: 'robot', languages: ['en', 'en', 'tr'], interests: ['##go', 'Chess'] });
  assert.strictEqual(p.value.bio, null);
  assert.strictEqual(p.value.country, null);
  assert.strictEqual(p.value.timezone, null);
  assert.ok(p.errors.gender);
  assert.deepStrictEqual(JSON.parse(p.value.languages), ['en', 'tr']);
  assert.deepStrictEqual(JSON.parse(p.value.interests), ['#go', 'Chess'], 'only one leading # is removed');
  assert.deepStrictEqual(JSON.parse(auth.validateProfile({ languages: 'en' }).value.languages), []);
  assert.strictEqual(auth.validateProfile({ city: 'Edin\tburgh' }).value.city, 'Edin burgh');
  assert.deepStrictEqual(auth.profileExtras({ interests: '{broken' }).interests, []);
});

test('MK-21: email links expire (verify 24 h, reset 1 h), are single use, and only the newest works', async () => {
  const u = makeUser();
  const v = await atTime(T0, () => auth.createEmailToken(u, 'verify'));
  await atTime(T0 + DAY, () => assert.strictEqual(auth.consumeEmailToken(v, 'verify'), u, 'valid on the last millisecond'));
  const v2 = await atTime(T0, () => auth.createEmailToken(u, 'verify'));
  await atTime(T0 + DAY + 1, () => assert.strictEqual(auth.consumeEmailToken(v2, 'verify'), null));
  const r1 = await atTime(T0, () => auth.createEmailToken(u, 'reset'));
  const r2 = await atTime(T0, () => auth.createEmailToken(u, 'reset'));
  assert.strictEqual(auth.consumeEmailToken(r1, 'reset'), null, 'superseded');
  await atTime(T0 + HOUR + 1, () => assert.strictEqual(auth.consumeEmailToken(r2, 'reset'), null, 'reset links last 1 h'));
  const r3 = await atTime(T0, () => auth.createEmailToken(u, 'reset'));
  assert.strictEqual(auth.consumeEmailToken(r3, 'verify'), null, 'purpose must match');
  await atTime(T0, () => assert.strictEqual(auth.recentlyEmailed(u, 'reset'), true));
  await atTime(T0 + 60e3, () => assert.strictEqual(auth.recentlyEmailed(u, 'reset'), false));
  await atTime(T0 + 59e3, () => assert.strictEqual(auth.recentlyEmailed(u, 'reset'), true));
});

test('MK-22: sessions last 30 days and are looked up by the hash of the cookie', async () => {
  const u = makeUser();
  const token = await atTime(T0, () => auth.createSession(u));
  const cookie = `${auth.COOKIE}=${token}`;
  await atTime(T0 + 30 * DAY, () => assert.strictEqual(auth.sessionFromCookieHeader(cookie).user.id, u));
  await atTime(T0 + 30 * DAY + 1, () => assert.strictEqual(auth.sessionFromCookieHeader(cookie), null));
  assert.strictEqual(auth.sessionFromCookieHeader('other=1'), null);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0, 'raw token never stored');
  assert.ok(auth.verifyPassword('pw12345678', auth.hashPassword('pw12345678')));
  assert.ok(!auth.verifyPassword('pw12345679', auth.hashPassword('pw12345678')));
  assert.match(auth.hashPassword('x'), /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.deepStrictEqual(auth.parseCookies('a=1=2; b= x '), { a: '1=2', b: 'x' });
});

test('MK-23: admin list parsing trims, lowercases and ignores blanks', () => {
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = ' Boss@Example.com , ,x@y.z';
  try { assert.deepStrictEqual(auth.adminEmails(), ['boss@example.com', 'x@y.z']); } finally { process.env.ADMIN_EMAILS = saved; }
});

test('MK-24: without TURN, clients get exactly Google\'s two public STUN servers', () => {
  const saved = process.env.TURN_SECRET;
  delete process.env.TURN_SECRET;
  try {
    assert.deepStrictEqual(iceServersFor(1), [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]);
  } finally { if (saved !== undefined) process.env.TURN_SECRET = saved; }
});
