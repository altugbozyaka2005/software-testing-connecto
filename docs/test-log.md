# Test log and results (LO3)

Testing campaign 12–13 Nov 2026 on the copy at `3f8e92f` (51 existing tests, all passing). Every defect was
handled test-first: a failing test was committed (`test: … (red)`), the run log saved, then the fix committed
separately (`fix: … (green)`). `git log --oneline` shows the pairs.

## Defects found

| Id | Found by (technique, level) | Defect | Severity | Red evidence | Fix |
|---|---|---|---|---|---|
| D1 | fault hypothesis from reading `parseCookies` → probe; regression + property P-AUTH-3 (integration) | Any cookie with a malformed `%` sequence made `decodeURIComponent` throw inside Socket.IO middleware: **one WebSocket handshake crashed the whole server** (all calls lost); HTTP routes returned 500 | 1 critical | `690da25`, `reports/test-runs/2026-11-13-red-before-fixes.txt` | `1320ff2` |
| D2 | category partition of report reasons (unit) | `REASONS[reason]` accepted `constructor`, `__proto__`, `toString`…; `['spam']` passed validation and then threw in SQLite | 3 | `690da25` | `1320ff2` |
| D3 | category partition by script (unit) | Word matcher removed every non-ASCII letter: identical Japanese/Russian text scored 0; Turkish words split into fragments that falsely matched (0.17 ≥ 0.15) | 2 (main market is TR) | `690da25` | `1320ff2` |
| D4 | probing all handlers with `null`, then fuzzing all 39 socket events (integration, property-based) | **Any signed-in user could crash the server** with `socket.emit('<event>', null)`: destructuring defaults don't apply to `null` and Socket.IO doesn't catch listener exceptions. 9 of 10 handlers probed | 1 critical | `690da25` | `1320ff2` (`guardHandlers`) |
| D5 | model-based testing of the request state machine (unit) | Cancelling deleted the request, so request/cancel loops bypassed the 20/day limit (each request notifies the target) | 3 | `040bd21`, `reports/test-runs/2026-11-13-red-D5.txt` | `f7a042c` |
| D6 | property-based test P-AUTH-1 (counterexample `{"gender":{"toString":{}}}`); fuzzers extended, found a 2nd site | `String()` on such objects throws: register returned 500 (and before D4's fix a socket payload would have crashed the server) | 3 | `343f218`, `reports/test-runs/2026-11-13-red-D6.txt` | `34b949e`, `2ae3193` (`parseDob`) |
| D7 | system test ST-5 (sideways wheel gesture, desktop) | Closed incoming-requests drawer (fixed + `translateX(100%)`) made the matches page scroll 420 px sideways | 4 cosmetic | `8bc0328`, `reports/system/2026-11-13-red-D7.txt` | `2494e5e` |
| D8 | accessibility audit, axe-core WCAG 2.1 AA (acceptance) | 22 serious violations on 8 screens: contrast of buttons/links/avatars as low as 1.53:1 (needs 4.5:1); account button's accessible name hid the visible name | 2 | `a2ccd56`, `reports/accessibility/before/`, `before-fix-2026-11-13.md` | `7611c26` |
| D9 | usability measurement run on a phone (acceptance) → system test ST-6 | Call screen's button row didn't wrap: page 524 px wide on a 412 px phone, zoomed out; report dialog's Send button covered by a label | 2 (blocks reporting on phones) | `9b7c669`, `reports/system/2026-11-13-red-D9.txt` | `5b8ad84` |
| D10 | code review checklist item 5 (R1) → integration test | In-call chat not rate limited; flooding pushes abuse out of the 100-message transcript kept with a report | 2 | `512121d`, `reports/test-runs/2026-11-13-red-D10.txt` | `0bfd7a0` |

Defects by level of the test that found them: unit 3 (D2, D3, D5), unit/property 1 (D6), integration 2 (D1, D4),
system 1 (D7), acceptance 2 (D8, D9), review 1 (D10). By kind: robustness 4, validation/limits 2, i18n 1, UI/layout 2,
accessibility 1. Open issues not fixed (low severity, from review): R8–R14 in [code-review.md](code-review.md);
usability observations H1–H3, H5 in [acceptance/heuristic-evaluation.md](acceptance/heuristic-evaluation.md).

## Problems found in the tests themselves

| Problem | How it showed | Change |
|---|---|---|
| node:test turns uncaught exceptions into warnings, so the in-process server could "crash" while the fuzz test passed | the first fuzz run passed with 39 `uncaughtException` notes in the log | crash oracle in `helpers.js`: every integration file fails if the server threw (`crashes[]`) |
| My expected values were wrong (not the code) | TS-REP-1 reported one person 7 times → correctly auto-suspended; `workout` also triggers *working*; Adjusted Wald hand value; synthetic perf users named `User1` (digits are invalid names, correctly refused) | fixed the oracles, noted in commit messages |
| Fuzz generators too narrow | D6 found by a property test, not by the fuzzers | generators now include `{toString:{}}`-style objects |
| `window.scrollTo` is not what a user does | ST-5 first failed on desktop for a clipped panel | oracle changed to a real sideways wheel gesture |
| A flaky integration test (existing `chat.test.js`, "block cuts it off") hung the coverage run under mutation-testing load | it waited for b to *disappear* from a's inbox, but if messages, report and block fell within one 120 ms recompute window the inbox never changed and was never pushed | wait for b to *appear* first; waiters registered before the action; `--test-timeout=60000` on every test script so a hang fails instead of blocking CI; whole suite re-run under load: 163/163 (`reports/test-runs/under-load-run.txt`) |
| Accessibility results lost on failure | Playwright restarts the worker after a failure, losing in-memory results | each screen's result written to disk immediately |

## Test runs (13 Nov 2026, Node 26.10, macOS arm64; CI uses Node 24)

| Suite | Command | Result |
|---|---|---|
| unit + property + integration | `npm test` | see `reports/test-runs/` (final: all pass) |
| coverage | `npm run test:coverage` | `reports/coverage/` (summary in evaluation.md) |
| browser system + acceptance (desktop + phone) | `npx playwright test` | 17 tests pass, `reports/system/` |
| accessibility | part of the above | 0 violations on 8 screens after D8 |
| usability metrics | part of the above | all 3 tasks within target on both devices, `reports/usability/task-metrics-*.json` |
| performance | `npm run test:perf` | QR1 met up to 800 searchers (p95 251 ms), `reports/performance/latency.md` |
| offline A/B | `npm run test:ab` | B > A (p = 0.00015); QR3 not met (0.74), `reports/ab/matcher-ab.md` |
| mutation | `npm run test:mutation` | `reports/mutation/mutation.html`, summary in evaluation.md |
