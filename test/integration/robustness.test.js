// Robustness of the HTTP and socket entry points against malformed client input (requirement SR4).
// Found by fault-hypothesis testing of auth.js parseCookies: decodeURIComponent throws URIError on a
// malformed %-sequence, and socket.io does not catch exceptions thrown by middleware. See docs/test-log.md D1.
const test = require('node:test');
const assert = require('node:assert');
const { start, stop, request, signedInSocket, Client } = require('../support/helpers');

let base;
test.before(async () => { base = await start(); });
test.after(stop);

const MALFORMED = ['other=%E0%A4%A', 'connecto_sid=%', 'a=%zz; connecto_sid=abc', '=%%%'];

test('D1: HTTP routes treat a malformed cookie as "not signed in" (401), not a server error', async () => {
  for (const cookie of MALFORMED) {
    const r = await request(base, 'GET', '/api/auth/me', null, cookie);
    assert.strictEqual(r.status, 401, `cookie ${cookie}`);
  }
});

test('D1: a socket handshake with a malformed cookie is refused and the server keeps serving others', async (t) => {
  const { sock: alive } = await signedInSocket(base, { firstName: 'Sana' });
  t.after(() => alive.close());
  for (const cookie of MALFORMED) {
    const bad = Client(base, { forceNew: true, transports: ['websocket'], extraHeaders: { cookie } });
    const err = await new Promise((resolve) => {
      bad.once('connect_error', (e) => resolve(e.message));
      bad.once('connect', () => resolve('connected'));
    });
    bad.close();
    assert.strictEqual(err, 'unauthorized', `cookie ${cookie}`);
  }
  // The process survived: an existing user can still act and the health check answers.
  const ack = await new Promise((r) => alive.emit('set-activity', { activity: 'still here' }, r));
  assert.deepStrictEqual(ack, { ok: true });
  assert.strictEqual((await request(base, 'GET', '/health')).status, 200);
});

test('a valid session cookie next to unrelated cookies still signs you in', async () => {
  const { cookie, sock } = await signedInSocket(base, { firstName: 'Tara' });
  sock.close();
  const r = await request(base, 'GET', '/api/auth/me', null, `theme=dark; ${cookie}; _ga=GA1.2.3`);
  assert.strictEqual(r.status, 200);
});

// Found by property-based testing (test/property/invariants.test.js P-AUTH-1): String() on a JSON
// object whose "toString" is not a function throws TypeError. See docs/test-log.md D6.
const POISON = [{ toString: {} }, { valueOf: {}, toString: {} }, { toString: 'x' }];

test('D6: object-valued fields in the registration body are rejected with 400, not a 500', async () => {
  const { newUser } = require('../support/helpers');
  for (const gender of POISON) {
    const r = await request(base, 'POST', '/api/auth/register', newUser({ gender }));
    assert.strictEqual(r.status, 400, JSON.stringify(gender));
    assert.ok(r.body.fields.gender);
  }
});

test('D6: poisoned objects in socket payloads are refused with an error ack', async (t) => {
  const { sock } = await signedInSocket(base, { firstName: 'Poison' });
  t.after(() => sock.close());
  for (const activity of POISON) {
    const ack = await new Promise((r) => sock.emit('set-activity', { activity }, r));
    assert.ok(ack.error, JSON.stringify(activity));
  }
});

// D10, found by code review (docs/code-review.md R1): in-call chat had no rate limit, unlike DMs, and the
// report transcript keeps only the last 100 messages, so flooding could also push abuse out of the evidence.
test('D10: in-call chat is limited to 15 messages per 10 seconds per person', async (t) => {
  const { matchUp } = require('../support/helpers');
  const a = await signedInSocket(base, { firstName: 'Flo' });
  const b = await signedInSocket(base, { firstName: 'Gil' });
  t.after(() => [a, b].forEach((x) => x.sock.close()));
  await matchUp(a.sock, b.sock, 'flood test origami folding');
  let received = 0;
  b.sock.on('chat', () => received++);
  for (let i = 0; i < 40; i++) a.sock.emit('chat', { text: `spam ${i}` });
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(received, 15);
});
