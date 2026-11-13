# Connecto

Asks "What are you doing right now?", matches you in real time with people doing
something similar, and drops you both into a video room when a request is accepted.

## Run

```bash
npm install
npm start          # http://localhost:3000
npm test           # matcher + end-to-end socket flow
```

To try it alone, open two browser windows (one normal, one incognito), create two
accounts, and enter similar activities.

## Testing (Software Testing coursework)

Start at [`docs/`](docs/): [requirements & strategy](docs/requirements.md) (LO1) · [test plan](docs/test-plan.md) (LO2) ·
[test log & defects D1–D10](docs/test-log.md) (LO3) · [evaluation, coverage, mutation, targets](docs/evaluation.md) (LO4) ·
[code review](docs/code-review.md) and [CI](docs/ci.md) (LO5) · [A/B testing](docs/ab-testing.md) ·
[usability study](docs/acceptance/usability-study.md) and [heuristic evaluation](docs/acceptance/heuristic-evaluation.md).

| Level / kind | Where | Run |
|---|---|---|
| Unit (partition, boundaries, pairwise, decision table, state machine) | `test/unit/` | `npm run test:unit` |
| Property-based and fuzzing (fast-check) | `test/property/` | `npm run test:property` |
| Integration (real sockets + HTTP, in-memory DB, crash oracle) | `test/integration/` | `npm run test:integration` |
| All of the above with coverage thresholds | | `npm test` / `npm run test:coverage` |
| System + acceptance in browsers (desktop + phone), accessibility, usability metrics | `test/system/`, `test/acceptance/` | `npx playwright install chromium && npm run test:system` |
| Mutation testing (Stryker) | `stryker.config.json` | `npm run test:mutation` |
| Performance / stress | `test/performance/` | `npm run test:perf` |
| Offline A/B of the matcher | `test/ab/` | `npm run test:ab` (needs the model: `node scripts/fetch-model.js`) |

Results and evidence are in [`reports/`](reports/). Instrumentation: `GET /metrics` with `METRICS_TOKEN` set (`metrics.js`).

## Production (reference only)

> **software-testing-connecto** is a separate testing copy of Connecto. It has no deploy script and
> no git remote, so it can't change the live site or the original GitHub repo. The notes below describe
> how the original app is hosted and are kept for reference.

The original runs at https://connecto.clientchase.com on a Hostinger VPS.

- **Deploy:** not available in this copy (the original's `deploy.sh` was removed).
- **HTTPS:** the existing Traefik (`/docker/traefik`) routes the domain via the labels in
  `compose.yaml` and renews the Let's Encrypt certificate automatically.
- **Data:** SQLite on the Docker volume `connecto_connecto_data` (`/data` in the container).
  Daily backup at 03:15 server time (`/etc/cron.d/connecto-backup`) into `/data/backups`,
  keeping 14. Restore: stop the container, copy a backup over `/data/connecto.db`, start it.
- **Logs:** `ssh connecto-vps docker logs -f connecto-connecto-1`
- **TURN relay:** coturn (`turn` service in `compose.yaml`, config in `deploy/turnserver.conf`)
  on UDP/TCP 3478 plus relay ports 49160–49999/udp, and `turns:` on 443 via Traefik for
  `turn.clientchase.com`. The app hands each user 12-hour credentials when a room opens
  (`turn.js`), signed with `TURN_SECRET`.
- **Email:** verification and password-reset links. Set `SMTP_URL` (and `MAIL_FROM`) in
  `/docker/connecto/.env`; without it, emails are printed to the container log.
- **Secrets:** `/docker/connecto/.env` on the server only (`TURN_SECRET`, `SMTP_URL`, `MAIL_FROM`).
- **Firewall:** ufw allows 22, 80, 443, 3478 tcp/udp and 49160–49999/udp. Ports published by
  Docker bypass ufw.

## How it works

| Piece | File | Notes |
|---|---|---|
| Accounts | `auth.js`, `db.js` | Sign up / sign in / log out. SQLite (built into Node) at `data/connecto.db`. Passwords hashed with scrypt; 30-day HttpOnly session cookies, stored hashed. Sign-ups require 18+. |
| Server | `server.js` | Express + Socket.IO. Holds online users, requests and rooms in memory. |
| Matching | `matcher.js` | Scores prompts 0–100% by activity category (e.g. "gym" ≈ "workout"), shared keywords, and typo-tolerant trigrams. The top 12 are pushed live whenever anyone joins, leaves or changes activity. |
| Client | `public/` | Plain HTML/CSS/JS, no build step. |
| Meeting room | `public/app.js` | WebRTC peer-to-peer video/audio (the server only relays signaling), plus text chat. |

Flow: sign up (first/last name, email, password, date of birth, optional gender and photo,
18+ and guidelines checkbox) or sign in → activity prompt → live match grid → click a card to
send a request → the other person accepts → both enter a room. Leaving puts you back in the
match list. Other users only see your first name and last initial, never your email, surname or
birth date.

Accounts API (JSON): `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`,
`GET /api/auth/me`, `PATCH /api/auth/me` (profile photo), `POST /api/auth/verify-email`,
`POST /api/auth/resend-verification`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`.

New accounts must confirm their email (24-hour link) before they can match. Password-reset links
last 1 hour, are single use, and sign the account out everywhere. Locally, emails are printed in
the terminal running `npm start`.

## Before going to production

- **HTTPS is required** for camera/mic anywhere except `localhost`.
- **Accounts**: move
  from SQLite to Postgres when you run more than one server; use the Socket.IO Redis adapter for
  realtime state. Set `NODE_ENV=production` (Secure cookies) and `TRUST_PROXY=1` behind a proxy.
- **Smarter matching**: swap `score()` in `matcher.js` for sentence embeddings if you want
  semantic matching beyond the built-in category list.
- **Safety**: add reporting/blocking before opening video chat to strangers.
