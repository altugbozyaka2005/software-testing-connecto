// Admin review of reports (FR7, SR2): the moderation branches the other suites did not reach
// (coverage gap in safety.js found in docs/evaluation.md: dismiss, unknown action, status filter).
const test = require('node:test');
const assert = require('node:assert');
const { start, stop, request, signedInSocket, call } = require('../support/helpers');

let base;
test.before(async () => { base = await start(); });
test.after(stop);

test('admins list reports by status, dismiss or suspend; others get 403; unknown actions 400', async (t) => {
  const admin = await signedInSocket(base, { firstName: 'Ada', email: 'admin@example.com' });
  const victim = await signedInSocket(base, { firstName: 'Bea' });
  const rude = await signedInSocket(base, { firstName: 'Cal' });
  const other = await signedInSocket(base, { firstName: 'Dov' });
  t.after(() => [admin, victim, rude, other].forEach((x) => x.sock.close()));

  for (const x of [victim, rude, other]) await call(x.sock, 'set-activity', { activity: 'admin test juggling practice' });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepStrictEqual(await call(victim.sock, 'report', { target: rude.sock.id, reason: 'harassment', details: 'rude' }), { ok: true });
  assert.deepStrictEqual(await call(other.sock, 'report', { target: rude.sock.id, reason: 'spam' }), { ok: true });

  assert.strictEqual((await request(base, 'GET', '/api/admin/reports', null, victim.cookie)).status, 403, 'not an admin');
  const open = await request(base, 'GET', '/api/admin/reports?status=open', null, admin.cookie);
  assert.strictEqual(open.status, 200);
  assert.strictEqual(open.body.reports.length, 2);
  assert.strictEqual(open.body.reports[0].reported.totalReporters, 2);
  assert.strictEqual(open.body.reports[0].reported.name.startsWith('Cal'), true, 'admins see full names');

  const [first, second] = open.body.reports;
  const bad = await request(base, 'POST', `/api/admin/reports/${first.id}`, { action: 'ban-forever' }, admin.cookie);
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await request(base, 'POST', '/api/admin/reports/999999', { action: 'dismiss' }, admin.cookie)).status, 404);

  assert.strictEqual((await request(base, 'POST', `/api/admin/reports/${first.id}`, { action: 'dismiss', note: '  not abusive  ' }, admin.cookie)).status, 200);
  const dismissed = await request(base, 'GET', '/api/admin/reports?status=dismissed', null, admin.cookie);
  assert.deepStrictEqual(dismissed.body.reports.map((r) => [r.id, r.resolutionNote]), [[first.id, 'not abusive']]);

  const suspended = new Promise((r) => rude.sock.once('suspended', r));
  assert.strictEqual((await request(base, 'POST', `/api/admin/reports/${second.id}`, { action: 'suspend' }, admin.cookie)).status, 200);
  await suspended;
  const actioned = await request(base, 'GET', '/api/admin/reports?status=actioned', null, admin.cookie);
  assert.deepStrictEqual(actioned.body.reports.map((r) => r.id), [second.id]);
  const list = await request(base, 'GET', '/api/admin/suspended', null, admin.cookie);
  assert.ok(list.body.users.some((u) => u.name.startsWith('Cal') && /report #/.test(u.reason)));
  assert.strictEqual((await request(base, 'GET', '/api/admin/reports?status=bogus', null, admin.cookie)).body.reports.length, 2, 'unknown status = all');
});
