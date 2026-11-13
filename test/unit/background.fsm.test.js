// Model-based testing of the connect-request lifecycle in background.js (requirement FR5).
// The state machine is documented in docs/test-specs/connect-request-fsm.md:
//
//   NONE --request(a,b)--> PENDING(a->b) --respond(b, yes)--> ACCEPTED --settle--> DONE
//                          PENDING(a->b) --request(b,a)----> ACCEPTED   (both asked: mutual yes)
//                          PENDING(a->b) --respond(b, no)--> DECLINED   (hidden; a may ask again)
//                          PENDING(a->b) --cancel(a)-------> NONE       (still counts toward a's daily limit)
//                          PENDING(a->b) --7 days---------->  expired
//                          ACCEPTED      --48 h (no meeting)> expired
//                          any           --forget (block)-->  NONE, history erased
//
// 1. Transition coverage: every transition above (T1..T12) plus the invalid ones (I1..I5) once.
// 2. Random walks (fast-check): long command sequences compared against an executable model.
const test = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { db, makeUser, atTime } = require('../support/db-fixture');
const bg = require('../../background');

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const statusOf = (a, b) => bg.between(a, b)?.status ?? 'none';

test('T1: request creates a pending request from a to b', () => {
  const [a, b] = [makeUser(), makeUser()];
  const r = bg.request(a, b, 'chess');
  assert.strictEqual(r.status, 'pending');
  assert.strictEqual(r.request.from_id, a);
  assert.strictEqual(r.request.activity, 'chess');
  assert.strictEqual(statusOf(b, a), 'pending', 'visible from either side');
  assert.strictEqual(bg.connected(a, b), false);
});

test('T2: asking again while pending is idempotent', () => {
  const [a, b] = [makeUser(), makeUser()];
  const first = bg.request(a, b, 'chess');
  const again = bg.request(a, b, 'chess');
  assert.strictEqual(again.status, 'pending');
  assert.strictEqual(again.request.id, first.request.id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM connect_requests WHERE from_id = ?').get(a).n, 1);
});

test('T3: b asking a back turns a pending request into a mutual yes', () => {
  const [a, b] = [makeUser(), makeUser()];
  bg.request(a, b, 'chess');
  assert.strictEqual(bg.request(b, a, 'chess').status, 'accepted');
  assert.ok(bg.connected(a, b) && bg.connected(b, a));
});

test('T4/T5: the recipient accepts or declines; a declined request disappears', () => {
  const [a, b, c] = [makeUser(), makeUser(), makeUser()];
  const r1 = bg.request(a, b, 'x').request;
  assert.strictEqual(bg.respond(r1.id, b, true).status, 'accepted');
  assert.strictEqual(statusOf(a, b), 'accepted');
  const r2 = bg.request(a, c, 'x').request;
  assert.strictEqual(bg.respond(r2.id, c, false).status, 'declined');
  assert.strictEqual(statusOf(a, c), 'none');
  assert.deepStrictEqual(bg.forAccount(c), []);
});

test('T6: a may ask again after being declined (a new pending request)', () => {
  const [a, b] = [makeUser(), makeUser()];
  const r = bg.request(a, b, 'x').request;
  bg.respond(r.id, b, false);
  const again = bg.request(a, b, 'x');
  assert.strictEqual(again.status, 'pending');
  assert.notStrictEqual(again.request.id, r.id);
});

test('T7: the sender can cancel a pending request', () => {
  const [a, b] = [makeUser(), makeUser()];
  const r = bg.request(a, b, 'x').request;
  bg.cancel(r.id, a);
  assert.strictEqual(statusOf(a, b), 'none');
});

test('T8: settle turns a pending or accepted request into history (done)', () => {
  const [a, b] = [makeUser(), makeUser()];
  bg.request(a, b, 'x');
  bg.request(b, a, 'x');
  bg.settle(a, b);
  assert.strictEqual(statusOf(a, b), 'none');
  assert.ok(bg.talkedRecently(a, b) && bg.talkedRecently(b, a));
  assert.strictEqual(bg.history(a)[0].status, 'done');
  assert.strictEqual(bg.request(a, b, 'again').status, 'pending', '"call again" starts a new request');
});

test('T9: forget (block) erases everything between two people, including history', () => {
  const [a, b] = [makeUser(), makeUser()];
  bg.request(a, b, 'x');
  bg.settle(a, b);
  bg.request(b, a, 'y');
  bg.forget(a, b);
  assert.strictEqual(statusOf(a, b), 'none');
  assert.strictEqual(bg.talkedRecently(a, b), false);
  assert.deepStrictEqual(bg.history(a), []);
});

test('T10 (boundary): a pending request expires exactly 7 days after it was sent', async () => {
  const [a, b] = [makeUser(), makeUser()];
  const t0 = Date.UTC(2026, 10, 3, 9);
  await atTime(t0, () => bg.request(a, b, 'x'));
  await atTime(t0 + 7 * DAY - 1, () => assert.strictEqual(statusOf(a, b), 'pending'));
  await atTime(t0 + 7 * DAY, () => {
    assert.strictEqual(statusOf(a, b), 'none');
    const r = db.prepare('SELECT id FROM connect_requests WHERE from_id = ?').get(a);
    assert.strictEqual(bg.respond(r.id, b, true), null, 'an expired request cannot be accepted');
  });
});

test('T11 (boundary): an accepted connection without a meeting lapses after 48 hours', async () => {
  const [a, b] = [makeUser(), makeUser()];
  const t0 = Date.UTC(2026, 10, 3, 9);
  await atTime(t0, () => { bg.request(a, b, 'x'); bg.request(b, a, 'x'); });
  await atTime(t0 + 48 * HOUR - 1, () => assert.strictEqual(bg.connected(a, b), true));
  await atTime(t0 + 48 * HOUR, () => assert.strictEqual(bg.connected(a, b), false));
});

test('T12 (boundary): a scheduled meeting keeps the connection open until 2 hours after it starts', async () => {
  const [a, b] = [makeUser(), makeUser()];
  const t0 = Date.UTC(2026, 10, 3, 9);
  const meeting = t0 + 5 * DAY;
  await atTime(t0, () => {
    const id = bg.request(a, b, 'x').request.id;
    bg.respond(id, b, true);
    assert.ok(!bg.propose(id, a, [meeting]).error);
    assert.strictEqual(bg.pick(id, b, meeting).meeting_at, meeting);
  });
  await atTime(meeting + 2 * HOUR - 1, () => assert.strictEqual(bg.connected(a, b), true));
  await atTime(meeting + 2 * HOUR, () => assert.strictEqual(bg.connected(a, b), false));
});

test('I1-I5: invalid transitions are refused and change nothing', () => {
  const [a, b, c] = [makeUser(), makeUser(), makeUser()];
  assert.match(bg.request(a, a, 'x').error, /That’s you/); // I1 self
  const r = bg.request(a, b, 'x').request;
  assert.strictEqual(bg.respond(r.id, a, true), null); // I2 sender answers own request
  assert.strictEqual(bg.respond(r.id, c, true), null); // I3 a third person answers
  bg.cancel(r.id, b); // I4 recipient "cancels" (only the sender can)
  assert.strictEqual(statusOf(a, b), 'pending');
  bg.respond(r.id, b, true);
  bg.cancel(r.id, a); // I5 cancel after acceptance
  assert.strictEqual(statusOf(a, b), 'accepted');
  assert.strictEqual(bg.respond(r.id, b, false), null, 'cannot decline once accepted');
});

test('D5 (boundary): at most 20 new requests a day, and cancelling does not reset the count', () => {
  const a = makeUser();
  for (let i = 0; i < 20; i++) {
    const r = bg.request(a, makeUser(), 'x');
    assert.strictEqual(r.status, 'pending', `request ${i + 1}`);
    bg.cancel(r.request.id, a); // withdraw it straight away
  }
  assert.match(bg.request(a, makeUser(), 'x').error || '', /a lot of requests/, '21st request in a day is refused');
});

// ---- Scheduling (part of the ACCEPTED state) ----

test('BV-SLOT: proposed times must be more than 5 minutes and less than 30 days ahead, at most 3', async () => {
  const [a, b] = [makeUser(), makeUser()];
  const now = Date.UTC(2026, 10, 4, 12);
  await atTime(now, () => {
    const id = bg.request(a, b, 'x').request.id;
    bg.respond(id, b, true);
    const MIN = 5 * 60e3, MAX = 30 * DAY;
    assert.match(bg.propose(id, a, [now + MIN]).error, /at least one time/, 'exactly 5 min ahead is too soon');
    assert.deepStrictEqual(JSON.parse(bg.propose(id, a, [now + MIN + 1]).proposed_slots), [now + MIN + 1]);
    assert.match(bg.propose(id, a, [now + MAX]).error, /at least one time/, 'exactly 30 days ahead is too far');
    assert.ok(!bg.propose(id, a, [now + MAX - 1]).error);
    const four = [1, 2, 3, 4].map((h) => now + h * HOUR);
    assert.match(bg.propose(id, a, four).error, /up to 3/);
    const dupes = [now + HOUR, now + HOUR, String(now + 2 * HOUR), 'junk', null];
    assert.deepStrictEqual(JSON.parse(bg.propose(id, a, dupes).proposed_slots), [now + HOUR, now + 2 * HOUR], 'deduped, sorted, junk dropped');
    assert.match(bg.propose(id, a, 'not a list').error, /at least one time/);
  });
});

test('scheduling: only the other person can pick, only a proposed and future time, and unschedule resets', async () => {
  const [a, b, c] = [makeUser(), makeUser(), makeUser()];
  const now = Date.UTC(2026, 10, 5, 12);
  const slot = now + 3 * HOUR;
  let id;
  await atTime(now, () => {
    id = bg.request(a, b, 'x').request.id;
    assert.match(bg.propose(id, a, [slot]).error, /no longer open/, 'not accepted yet');
    bg.respond(id, b, true);
    bg.propose(id, a, [slot, slot + HOUR]);
    assert.match(bg.pick(id, a, slot).error, /no longer open/, 'proposer cannot pick');
    assert.match(bg.pick(id, c, slot).error, /no longer open/, 'outsider cannot pick');
    assert.match(bg.pick(id, b, slot + 1).error, /one of the proposed/);
  });
  await atTime(slot + 1, () => assert.match(bg.pick(id, b, slot).error, /has passed/));
  await atTime(now, () => {
    assert.strictEqual(bg.pick(id, b, String(slot + HOUR)).meeting_at, slot + HOUR);
    assert.ok(bg.unschedule(id, a));
    const row = db.prepare('SELECT * FROM connect_requests WHERE id = ?').get(id);
    assert.strictEqual(row.meeting_at, null);
    assert.strictEqual(row.proposed_slots, null);
    assert.strictEqual(bg.unschedule(id, c), null);
  });
});

test('reminders fire once, within 10 minutes before a meeting', async () => {
  const [a, b] = [makeUser(), makeUser()];
  const now = Date.UTC(2026, 10, 6, 12);
  const meeting = now + HOUR;
  await atTime(now, () => {
    const id = bg.request(a, b, 'x').request.id;
    bg.respond(id, b, true);
    bg.propose(id, a, [meeting]);
    bg.pick(id, b, meeting);
  });
  const mine = (rows) => rows.filter((r) => r.from_id === a);
  await atTime(meeting - 10 * 60e3 - 1, () => assert.strictEqual(mine(bg.dueReminders()).length, 0));
  await atTime(meeting - 10 * 60e3, () => assert.strictEqual(mine(bg.dueReminders()).length, 1));
  await atTime(meeting - 5 * 60e3, () => assert.strictEqual(mine(bg.dueReminders()).length, 0, 'only once'));
});

// ---- Random walks against an executable model ----

function model() {
  const live = new Map(); // "x|y" (sorted) -> { from, to, status }
  const sent = new Map(); // user -> requests created today
  const key = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  return {
    live, key,
    request(x, y) {
      if (x === y) return 'error';
      const l = live.get(key(x, y));
      if (l) {
        if (l.status === 'pending' && l.to === x) l.status = 'accepted';
        return l.status;
      }
      if ((sent.get(x) || 0) >= 20) return 'error';
      sent.set(x, (sent.get(x) || 0) + 1);
      live.set(key(x, y), { from: x, to: y, status: 'pending' });
      return 'pending';
    },
    respond(x, y, accept) {
      const l = live.get(key(x, y));
      if (!l || l.status !== 'pending' || l.to !== x) return null;
      if (accept) l.status = 'accepted';
      else live.delete(key(x, y));
      return accept ? 'accepted' : 'declined';
    },
    cancel(x, y) {
      const l = live.get(key(x, y));
      if (l && l.status === 'pending' && l.from === x) live.delete(key(x, y));
    },
    settle(x, y) { live.delete(key(x, y)); },
  };
}

test('random command sequences behave like the model (fast-check, 200 walks)', () => {
  const cmd = fc.tuple(fc.constantFrom('request', 'respond', 'cancel', 'settle'), fc.nat(3), fc.nat(3), fc.boolean());
  fc.assert(
    fc.property(fc.array(cmd, { minLength: 1, maxLength: 40 }), (cmds) => {
      const users = [makeUser(), makeUser(), makeUser(), makeUser()];
      const m = model();
      for (const [op, i, j, flag] of cmds) {
        const [x, y] = [users[i], users[j]];
        if (op === 'request') {
          const r = bg.request(x, y, 'walk');
          assert.strictEqual(r.error ? 'error' : r.status, m.request(x, y), `request ${i}->${j}`);
        } else if (op === 'respond') {
          const id = bg.between(x, y)?.id ?? 0;
          assert.strictEqual(bg.respond(id, x, flag)?.status ?? null, m.respond(x, y, flag), `respond ${i}<-${j}`);
        } else if (op === 'cancel') {
          bg.cancel(bg.between(x, y)?.id ?? 0, x);
          m.cancel(x, y);
        } else if (x !== y) {
          bg.settle(x, y);
          m.settle(x, y);
        }
        // Invariant: the implementation's view of every pair equals the model's.
        for (const p of users) for (const q of users) {
          if (p >= q) continue;
          const l = m.live.get(m.key(p, q));
          const r = bg.between(p, q);
          assert.strictEqual(r?.status ?? 'none', l?.status ?? 'none', `pair ${p},${q} after ${op}`);
          if (l) assert.strictEqual(r.from_id, l.from);
          assert.strictEqual(bg.connected(p, q), l?.status === 'accepted');
        }
      }
    }),
    { numRuns: 200 },
  );
});
