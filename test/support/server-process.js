// Scaffolding for black-box (system, acceptance, performance) tests: runs the real server as a separate
// process on a free port with an in-memory database, and reads email links from its console output
// (MAIL transport "console"), so tests can confirm accounts without any test-only route in the app.
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  srv.on('error', reject);
});

async function startServer(env = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), DB_PATH: ':memory:', EMBEDDINGS: 'off', NODE_ENV: 'test',
      AUTH_RATE_LIMIT: '100000', ADMIN_EMAILS: 'admin@example.com', SMTP_URL: '', MAIL_TRANSPORT: '', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const links = new Map(); // email -> { verify, reset }
  let buf = '';
  let to = null;
  const onData = (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const m = line.match(/^\[mail\] To: (.+)$/);
      if (m) to = m[1];
      const link = line.match(/\?(verify|reset)=([A-Za-z0-9_-]+)/);
      if (link && to) links.set(to, { ...links.get(to), [link[1]]: link[2] });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', () => {});
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  async function link(email, kind = 'verify') {
    for (let i = 0; i < 100; i++) {
      const l = links.get(email.toLowerCase())?.[kind];
      if (l) return l;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no ${kind} email for ${email}`);
  }
  return { base, port, link, stop: () => child.kill() };
}

module.exports = { startServer };
