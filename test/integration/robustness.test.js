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
