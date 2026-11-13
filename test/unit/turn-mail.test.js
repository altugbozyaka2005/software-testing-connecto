// Unit tests for TURN credentials (turn.js, requirement SR6) and outgoing email (mail.js, FR8).
process.env.MAIL_TRANSPORT = 'memory';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { iceServersFor } = require('../../turn');
const mail = require('../../mail');

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test('without a TURN secret or host, only public STUN servers are handed out', () => {
  for (const env of [{ TURN_SECRET: undefined, TURN_HOST: 'h' }, { TURN_SECRET: 's', TURN_HOST: undefined }]) {
    const servers = withEnv(env, () => iceServersFor(7));
    assert.strictEqual(servers.length, 1);
    assert.ok(servers[0].urls.every((u) => u.startsWith('stun:stun')));
  }
});

test('TURN credentials: "<expiry>:<account>" signed with HMAC-SHA1 of the shared secret, valid 12 hours', () => {
  const real = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    const [, turn] = withEnv({ TURN_SECRET: 'sekret', TURN_HOST: '203.0.113.7', TURN_TLS_HOST: undefined }, () => iceServersFor(42));
    assert.strictEqual(turn.username, `${1_800_000_000 + 12 * 3600}:42`);
    assert.strictEqual(turn.credential, crypto.createHmac('sha1', 'sekret').update(turn.username).digest('base64'));
    assert.deepStrictEqual(turn.urls, ['stun:203.0.113.7:3478', 'turn:203.0.113.7:3478?transport=udp', 'turn:203.0.113.7:3478?transport=tcp']);
    const [, tls] = withEnv({ TURN_SECRET: 'sekret', TURN_HOST: 'h', TURN_TLS_HOST: 'turn.example.com' }, () => iceServersFor(42));
    assert.strictEqual(tls.urls.at(-1), 'turns:turn.example.com:443?transport=tcp');
  } finally {
    Date.now = real;
  }
});

test('emails: user-supplied text is HTML-escaped in the HTML part but readable in the text part', async () => {
  await mail.sendVerificationEmail({ email: 'x@example.com', first_name: '<img src=x onerror=alert(1)>' }, 'http://localhost/?verify=abc');
  const m = mail.outbox.at(-1);
  assert.strictEqual(m.to, 'x@example.com');
  assert.ok(!m.html.includes('<img src=x'), 'escaped in HTML');
  assert.ok(m.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(m.text.includes('Welcome, <img src=x onerror=alert(1)>!'));
  assert.ok(m.text.includes('http://localhost/?verify=abc'));
});

test('password reset and admin report emails carry the right subject and link', async () => {
  await mail.sendPasswordResetEmail({ email: 'r@example.com', first_name: 'Rae' }, 'http://localhost/?reset=t0k');
  assert.match(mail.outbox.at(-1).subject, /Reset your Connecto password/);
  assert.ok(mail.outbox.at(-1).text.includes('?reset=t0k'));
  await mail.sendAdminReportEmail(['a@example.com', 'b@example.com'], { reportedName: 'Bo X', reportedEmail: 'bo@example.com', reason: 'Spam', details: '', reporters: 1, autoSuspended: false });
  const admin = mail.outbox.at(-1);
  assert.strictEqual(admin.to, 'a@example.com, b@example.com');
  assert.strictEqual(admin.subject, 'New report: Bo X');
  assert.match(admin.text, /1 person has reported/);
});

test('connect notices: one subject per kind, times shown in the recipient\'s time zone (or UTC)', async () => {
  const at = Date.UTC(2026, 10, 10, 18, 0);
  const kinds = ['message', 'proposed', 'scheduled', 'reminder', 'request', 'accepted', 'match'];
  const subjects = new Set();
  for (const kind of kinds) {
    await mail.sendConnectNotice({ email: 'n@example.com', first_name: 'Nil', timezone: 'Europe/Istanbul' }, { kind, name: 'Ata', activity: 'chess', at });
    subjects.add(mail.outbox.at(-1).subject);
  }
  assert.strictEqual(subjects.size, kinds.length);
  assert.ok([...subjects].some((s) => s.includes('9:00 PM')), 'Istanbul is UTC+3');
  await mail.sendConnectNotice({ email: 'n@example.com', first_name: 'Nil', timezone: 'Not/AZone' }, { kind: 'scheduled', name: 'Ata', at });
  assert.match(mail.outbox.at(-1).subject, /18:00:00 GMT|6:00 PM/, 'invalid zone falls back');
  assert.ok(mail.outbox.at(-1).text.includes('/#connects'));
});
