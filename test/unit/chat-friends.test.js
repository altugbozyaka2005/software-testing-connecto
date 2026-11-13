// Unit tests for direct messages (chat.js, requirement FR6/SR3) and friendships (friends.js, FR4).
// Category partition of send() inputs, boundary values of length and rate limits (BV-DM-n), and
// the "who may message whom" decision table (DT-DM).
const test = require('node:test');
const assert = require('node:assert');
const { db, makeUser, atTime } = require('../support/db-fixture');
const chat = require('../../chat');
const friends = require('../../friends');
const safety = require('../../safety');

const pair = () => {
  const [a, b] = [makeUser(), makeUser()];
  chat.connect(a, b);
  return [a, b];
};

test('TS-DM-1: text is trimmed, CRLF normalised, and runs of 4+ newlines collapsed to 3', () => {
  const [a, b] = pair();
  const { message } = chat.send(a, b, '  hi\r\nthere\r\n\n\n\n\nbye  ');
  assert.strictEqual(message.body, 'hi\nthere\n\n\nbye');
});

test('TS-DM-2 [error]: empty, whitespace-only and non-string messages are refused', () => {
  const [a, b] = pair();
  for (const body of ['', '   \n  ', null, undefined, 42, { text: 'x' }]) {
    assert.match(chat.send(a, b, body).error, /Type a message/, String(body));
  }
});

test('BV-DM-1: messages may be 2000 characters, not 2001', () => {
  const [a, b] = pair();
  assert.ok(chat.send(a, b, 'x'.repeat(2000)).message);
  assert.match(chat.send(a, b, 'x'.repeat(2001)).error, /up to 2000/);
});

test('DT-DM: only connected or befriended, unblocked, different people can message', () => {
  const [a, b, c, d] = [makeUser(), makeUser(), makeUser(), makeUser()];
  chat.connect(a, b);
  friends.request(a, c);
  friends.request(c, a);
  //            connected friends  blocked  self   -> may message
  const table = [
    [a, b, true],  // connected
    [a, c, true],  // friends
    [a, d, false], // neither
    [a, a, false], // self
  ];
  for (const [x, y, expected] of table) assert.strictEqual(chat.canMessage(x, y), expected, `${x}->${y}`);
  safety.block(b, a);
  assert.strictEqual(chat.canMessage(a, b), false, 'blocked overrides connected');
  assert.match(chat.send(a, b, 'hello').error, /connected with/);
  assert.deepStrictEqual(chat.contacts(a).sort(), [c].sort(), 'blocked contacts are hidden');
});

test('BV-DM-2: at most 15 messages per 10 seconds; the 16th waits for the window to pass', async () => {
  const [a, b] = pair();
  const t0 = Date.UTC(2026, 10, 7, 12);
  await atTime(t0, () => {
    for (let i = 0; i < 15; i++) assert.ok(chat.send(a, b, `m${i}`).message, `message ${i + 1}`);
    assert.match(chat.send(a, b, 'm16').error, /too fast/);
  });
  await atTime(t0 + 10e3, () => assert.ok(chat.send(a, b, 'later').message));
});

test('BV-DM-3: at most 1000 messages per 24 hours', async () => {
  const [a, b] = pair();
  const t0 = Date.UTC(2026, 10, 8, 12);
  const insert = db.prepare('INSERT INTO messages (from_id, to_id, body, created_at) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 999; i++) insert.run(a, b, 'x', t0 - 60e3);
  await atTime(t0, () => {
    assert.ok(chat.send(a, b, '1000th').message);
    assert.match(chat.send(a, b, '1001st').error, /too fast/);
  });
});

test('history pages 50 at a time, oldest first, with a "more" flag; markRead and summaries agree', () => {
  const [a, b] = pair();
  const insert = db.prepare('INSERT INTO messages (from_id, to_id, body, created_at) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 51; i++) insert.run(i % 2 ? a : b, i % 2 ? b : a, `m${i}`, 1000 + i);
  const page = chat.history(a, b);
  assert.strictEqual(page.messages.length, 50);
  assert.strictEqual(page.more, true);
  assert.strictEqual(page.messages[0].body, 'm1');
  assert.strictEqual(page.messages.at(-1).body, 'm50');
  const older = chat.history(a, b, page.messages[0].id);
  assert.deepStrictEqual(older.messages.map((m) => m.body), ['m0']);
  assert.strictEqual(older.more, false);
  assert.strictEqual(chat.summaries(a).get(b).unread, 26, 'messages from b (even i) are unread');
  assert.strictEqual(chat.markRead(a, b), 26);
  assert.strictEqual(chat.summaries(a).get(b).unread, 0);
  assert.strictEqual(chat.summaries(a).get(b).last.body, 'm50');
});

test('disconnect removes the connection both ways but keeps messages for moderation', () => {
  const [a, b] = pair();
  chat.send(a, b, 'keep me');
  chat.disconnect(b, a);
  assert.strictEqual(chat.isConnected(a, b), false);
  assert.strictEqual(chat.transcript(a, b).length, 1);
  assert.strictEqual(chat.connectedSince(a, b), null);
});

test('friends: a request becomes a friendship only when both say yes; decline and remove are quiet', () => {
  const [a, b, c] = [makeUser(), makeUser(), makeUser()];
  assert.throws(() => friends.request(a, a), /yourself/);
  assert.strictEqual(friends.request(a, b), 'pending');
  assert.strictEqual(friends.request(a, b), 'pending', 'asking twice is harmless');
  assert.deepStrictEqual(friends.incomingRequestIds(b), [a]);
  assert.strictEqual(friends.areFriends(a, b), false);
  assert.strictEqual(friends.request(b, a), 'friends');
  assert.ok(friends.areFriends(a, b) && friends.areFriends(b, a));
  assert.deepStrictEqual(friends.incomingRequestIds(b), [], 'request consumed');
  assert.strictEqual(friends.request(a, b), 'friends');
  friends.request(c, a);
  friends.decline(c, a);
  assert.deepStrictEqual(friends.incomingRequestIds(a), []);
  friends.remove(b, a);
  assert.strictEqual(friends.areFriends(a, b), false);
  assert.deepStrictEqual(friends.friendIds(a), []);
});
