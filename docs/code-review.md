# Code review (LO5.1)

**Method.** Checklist-based inspection (Y&P ch. 18) of the modules where a fault costs most, chosen from the
risk ranking in [test-plan.md](test-plan.md) section 2: input handling in `server.js` (all 39 socket handlers),
`auth.js` (validation, cookies, sessions), `safety.js` (reports, blocks), `background.js` (requests, scheduling),
`chat.js`, and the scoring in `matcher.js`. One reviewer (me), reading against the checklist below, about 4 hours,
13 Nov 2026, on commit `1320ff2`→`2ae3193`. Each issue gets an ODC-style defect type (Y&P ch. 20), a severity
(1 critical … 4 cosmetic) and a disposition. Issues were turned into tests where possible, so review and testing
check each other: some issues found by testing were then traced to their root cause by review (marked T→R),
and some found by review were confirmed by a new failing test (R→T).

## Checklist

From the lecture "Test Automation and Code Review" (names, data errors, exceptions, types, formatting), extended
for a realtime, multi-user, safety-relevant service:

1. **Untrusted input:** is every value from a client (socket payload, JSON body, header, cookie) type-checked before use? Can it throw?
2. **Exceptions:** can an exception escape a handler or timer callback, and what happens then (Node crashes on uncaught errors)?
3. **Data errors tested:** are the error/limit branches covered by a test at their boundary?
4. **Types consistent:** are values compared and stored with consistent types (string vs number ids, arrays vs strings)?
5. **Abuse and limits:** can a signed-in user flood or harass others; is every limit enforced on the server and impossible to reset?
6. **Privacy:** does any payload sent to another user contain surname, email, date of birth?
7. **State and side effects:** does a refused operation leave state unchanged? Are time windows consistent?
8. **Resources:** do in-memory maps and timers get cleaned up; is any per-event work super-linear in the number of users?
9. **SQL:** parameterised queries only; any dynamic SQL from a fixed set.
10. **Names, formatting, structure:** meaningful names, consistent error style, functions small enough to test.

## Issues found

| # | Where | Checklist | ODC type | Sev | Issue | Disposition |
|---|---|---|---|---|---|---|
| R1 | `server.js` `socket.on('chat')` | 5 | checking (missing) | 2 | In-call chat had no rate limit (DMs: 15/10 s). Flooding is harassment and pushes earlier messages out of the 100-message transcript attached to a report, destroying evidence. | **D10**, R→T: `robustness.test.js` "D10…" (red, then fixed: 15 messages / 10 s per tab, `chat.rate_limited` metric) |
| R2 | `server.js`, every `socket.on(..., ({ x } = {}) => …)` | 1, 2 | checking | 1 | Default parameters only replace `undefined`; a `null` payload throws on destructuring, and Socket.IO does not catch listener exceptions, so the process exits. | **D4**, T→R: found by probing, root cause here; fixed once in `guardHandlers` (payload normalisation + error boundary) instead of 39 edits |
| R3 | `auth.js` `parseCookies` | 1, 2 | checking | 1 | `decodeURIComponent` throws on a malformed cookie, inside Socket.IO middleware. | **D1**, fixed; P-AUTH-3 property test |
| R4 | `safety.js` `REASONS[reason]` | 1, 4 | checking | 3 | Object lookup accepts inherited keys and arrays (`['spam']` → `'spam'`, then SQLite throws). | **D2**, fixed with `typeof` + `Object.hasOwn` |
| R5 | `auth.js` `String(body.gender)`, `parseDob`; `server.js` `clean` | 1, 4 | checking | 3 | `String()` on an object with a non-function `toString` throws. | **D6**, found by property test, all `String(` call sites reviewed (`grep -n "String(" *.js`), two more fixed |
| R6 | `background.js` `cancel` | 5, 7 | algorithm | 3 | Deleting cancelled requests reset the daily limit (request/cancel loops). | **D5**, found by the FSM model, fixed |
| R7 | `matcher.js` `CATEGORIES` | 4 | algorithm | 3 | Generic verbs are category triggers (`play`, `watch`, `listen`, `learn`, `train`, `test`), and the same-category floor (≥ 0.3 + 0.4·overlap) then makes "playing chess" ~ "playing football" score 0.7. `train` is in two categories; `workout` also hits *working* via the `work` prefix. | Confirmed statistically by the A/B (specificity 0.47); not changed (product decision), candidate fix evaluated in `reports/ab/matcher-ab.md` (variant C) |
| R8 | `server.js` `connect-propose` with `accountId` | 7 | function | 4 | `background.reopen` opens/accepts a connection *before* the slots are validated, so an invalid proposal still changes state ("ready to talk" appears). | Open; fix: validate slots first. Logged in test-log |
| R9 | `server.js` `respond-request` | 7 | interface | 4 | If the responder is not available, the request is removed from both sides but the requester gets no `request-declined`, so their UI only updates on the next push. | Open (low impact) |
| R10 | `chat.js` `sentAt` Map | 8 | resource | 4 | Per-account send timestamps are never deleted; grows with every account that ever sent a message. Same pattern: `auth.js` rate limiter is pruned, `chat.js` is not. | Open; fix: prune in the hourly interval |
| R11 | `server.js` `scheduleRecompute` → `matchesFor`, `inboxFor` | 8 | algorithm | 3 | Every change recomputes every searching user's list against everyone (O(N²) scores) plus several DB queries per user for the inbox. | Measured: recompute p95 26 ms @100, 188 ms @800 users (`reports/performance/latency.md`); fine now, first bottleneck later |
| R12 | `auth.js` `validateProfile` | 3 | documentation | 4 | Bio rule allows exactly 200 characters but the message says "under 200". | Open (wording); boundary test BV-AUTH-6 pins the behaviour |
| R13 | `friends.request` throws on self; other modules return `{ error }` | 10 | interface | 4 | Inconsistent error style; callers must know which. Server guards before calling, so not reachable. | Open (style) |
| R14 | `server.js` (1,460 lines) | 10 | — | 4 | One file holds matching, rooms, requests, friends, background, DMs; long handlers (`room-invite-respond`, `inboxFor`) are hard to unit test, which is why server.js has the lowest branch coverage of the core files. | Recommendation: split per feature, as already done for the domain modules |

## Things checked and found sound

- **SQL (9):** every query is a prepared statement with `?` parameters. The only dynamic SQL, `UPDATE users SET ${field}`
  in `PATCH /me`, takes `field` from `validateProfile`'s fixed set of keys, never from the request.
- **Passwords and sessions:** scrypt with per-user salt, `timingSafeEqual`, a dummy hash for unknown emails (no
  user enumeration by timing; tested in `auth.test.js`), session and email tokens stored only as SHA-256 hashes,
  single-use reset links that revoke all sessions.
- **Privacy (6):** `publicUser()` and `displayName()` are the only shapes sent about other people; tested end to end by US-2.
- **CSRF:** writes require `Content-Type: application/json` plus SameSite cookies (`jsonOnly`; tested).

## How review and testing complemented each other

Of the ten defects (D1–D10), testing found nine (D1–D9) and review found one (D10) plus a set of lower-severity
issues no test had exercised (R8–R14). Review was also what turned single test failures into *classes*
(R2: all 39 handlers, R5: every `String(` call), which a single failing test would not have shown. Testing
found what review missed: D3 (scripts other than Latin) and D7–D9 (layout), which are hard to see by reading code.
