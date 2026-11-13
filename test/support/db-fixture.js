// Scaffolding for unit tests of modules that use the database (safety, chat, friends, background).
// Must be required BEFORE those modules: it points db.js at a fresh in-memory SQLite database and
// switches mail to the in-memory outbox, so each test file runs isolated and offline.
process.env.DB_PATH = ':memory:';
process.env.EMBEDDINGS = 'off';
process.env.MAIL_TRANSPORT = 'memory';
const db = require('../../db');

let n = 0;
// Inserts an account row directly (bypassing HTTP) and returns its id.
function makeUser(overrides = {}) {
  n++;
  const row = {
    email: `fixture${n}@example.com`,
    password_hash: 'scrypt$x$y',
    first_name: `First${n}`,
    last_name: `Last${n}`,
    date_of_birth: '1995-06-15',
    terms_accepted_at: Date.now(),
    created_at: Date.now(),
    email_verified_at: Date.now(),
    ...overrides,
  };
  const cols = Object.keys(row);
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
  return Number(lastInsertRowid);
}

// Replaces Date.now for the duration of fn (sync or async), so time-based rules can be tested
// at their boundaries without waiting.
async function atTime(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

module.exports = { db, makeUser, atTime };
