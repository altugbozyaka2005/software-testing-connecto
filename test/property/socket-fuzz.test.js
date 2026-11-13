// Robustness requirement SR4: "No message a signed-in client sends can stop the server or affect other
// users' sessions." Property-based fuzzing (fast-check) of every Socket.IO event handler with arbitrary
// JSON payloads, plus payloads built from real ids so handlers get past their first guard clause.
// The server runs in this process, so a handler that throws would kill this test run (defect D4).
const test = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { crashes, start, stop, request, signedInSocket, call } = require('../support/helpers');

// Every client->server event in server.js (checked by the last test below).
const EVENTS = [
  'refresh-profile', 'set-activity', 'stop-searching', 'send-request', 'cancel-request', 'respond-request',
  'media-ready', 'signal', 'media-state', 'chat', 'friend-request', 'friend-respond', 'friend-remove',
  'friend-invite', 'room-invite-respond', 'bg-start', 'bg-stop', 'notify-email', 'connect-request',
  'connect-respond', 'connect-cancel', 'connect-propose', 'connect-pick', 'connect-unschedule', 'dm-send',
  'dm-history', 'dm-read', 'dm-typing', 'connect-call', 'block', 'report', 'set-prefs', 'create-room',
  'room-settings', 'join-request', 'cancel-join', 'join-respond', 'remove-member', 'leave-room',
];
const FIELDS = ['to', 'from', 'id', 'text', 'activity', 'accountId', 'target', 'reason', 'roomId', 'hours',
  'slots', 'slot', 'body', 'with', 'capacity', 'mode', 'accept', 'open', 'lastPeer', 'searchId', 'details', 'before', 'on'];
const RUNS = Number(process.env.FUZZ_RUNS) || 25;

let base;
test.before(async () => { base = await start(); });
test.after(stop);

test('SR4 / D4: no payload sent to any socket event crashes the server', { timeout: 120000 }, async (t) => {
  const fuzzer = await signedInSocket(base, { firstName: 'Fuzz' });
  const partner = await signedInSocket(base, { firstName: 'Partner' });
  t.after(() => [fuzzer, partner].forEach((x) => x.sock.close()));
  await call(partner.sock, 'set-activity', { activity: 'fuzz testing a chess engine' });

  // Values that refer to real things, mixed with junk of every JSON type.
  const realish = fc.constantFrom(partner.sock.id, fuzzer.sock.id, partner.user.id, fuzzer.user.id, 'spam', 24, 2, true);
  // Objects that break String()/template literals (added after D6 showed the generator missed them).
  const poison = fc.constantFrom({ toString: {} }, { valueOf: {}, toString: {} }, { toString: 'x' }, { length: -1 });
  const value = fc.oneof(realish, poison, fc.jsonValue({ maxDepth: 2 }));
  const payload = fc.oneof(
    fc.constant(null),
    fc.jsonValue({ maxDepth: 2 }),
    fc.dictionary(fc.constantFrom(...FIELDS), value, { maxKeys: 4 }),
  );

  for (const event of EVENTS) {
    await fc.assert(
      fc.asyncProperty(payload, fc.boolean(), async (p, withAck) => {
        if (withAck) fuzzer.sock.emit(event, p, () => {});
        else fuzzer.sock.emit(event, p);
        return true;
      }),
      { numRuns: RUNS },
    );
    // Round trip: every event above has been handled once this answers.
    const ack = await call(fuzzer.sock, 'dm-history', { with: 0 });
    assert.ok(ack.error, `server still answering after fuzzing "${event}"`);
  }
  assert.deepStrictEqual(crashes.map((e) => e.message), [], 'no handler threw');
  assert.ok(fuzzer.sock.connected && partner.sock.connected, 'clients still connected');
  assert.strictEqual((await request(base, 'GET', '/health')).status, 200);
});

test('SR4: the server answers acks with an error, not silence, when a handler fails', async (t) => {
  const a = await signedInSocket(base, { firstName: 'Ack' });
  t.after(() => a.sock.close());
  for (const event of ['send-request', 'set-activity', 'report', 'dm-send', 'bg-start']) {
    const reply = await new Promise((resolve) => {
      a.sock.emit(event, null, resolve);
      setTimeout(() => resolve('no reply'), 1000);
    });
    assert.ok(reply && typeof reply.error === 'string', `${event} -> ${JSON.stringify(reply)}`);
  }
});

test('SR4: arbitrary JSON bodies never produce a 5xx from the HTTP API', { timeout: 120000 }, async (t) => {
  const { cookie, sock } = await signedInSocket(base, { firstName: 'Http' });
  t.after(() => sock.close());
  const routes = [
    ['POST', '/api/auth/register'], ['POST', '/api/auth/login'], ['POST', '/api/auth/verify-email'],
    ['POST', '/api/auth/forgot-password'], ['POST', '/api/auth/reset-password'], ['PATCH', '/api/auth/me'],
    ['POST', '/api/auth/resend-verification'], ['POST', '/api/admin/reports/1'],
  ];
  const body = fc.oneof(
    fc.dictionary(fc.constantFrom('email', 'password', 'firstName', 'lastName', 'dateOfBirth', 'gender', 'avatar',
      'acceptTerms', 'token', 'bio', 'city', 'country', 'languages', 'timezone', 'interests', 'action', 'note'),
    fc.oneof(fc.jsonValue({ maxDepth: 2 }), fc.constantFrom({ toString: {} }, { valueOf: {}, toString: {} })), { maxKeys: 6 }),
    fc.array(fc.jsonValue({ maxDepth: 1 }), { maxLength: 3 }),
  );
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...routes), body, fc.boolean(), async ([method, path], b, signedIn) => {
      const r = await request(base, method, path, b, signedIn ? cookie : undefined);
      return r.status < 500;
    }),
    { numRuns: RUNS * 8 },
  );
});

test('the fuzzed event list matches the handlers registered in server.js', () => {
  const src = require('fs').readFileSync(require.resolve('../../server.js'), 'utf8');
  const registered = [...src.matchAll(/socket\.on\('([a-z-]+)'/g)].map((m) => m[1]).filter((e) => e !== 'disconnect');
  assert.deepStrictEqual([...new Set(registered)].sort(), [...EVENTS].sort());
});
