# Connecto: test plan (LO2)

Follows the structure of the LO2 tutorial (priorities → scaffolding and instrumentation → process and risk)
with the ISO/IEC/IEEE 29119-3 agile test plan headings where useful. Requirements and their IDs are in
[requirements.md](requirements.md); results are in [test-log.md](test-log.md) and [evaluation.md](evaluation.md).

## 1. Context and lifecycle

Connecto is developed by one person in small increments (git history: one feature per commit, 2–11 Oct 2026),
each feature committed with an integration test (e.g. `a0e99f0` background search + `test/integration/background.test.js`,
`c4f970e` match preferences + `prefs.test.js`). That is the "test with each increment" practice of XP (Y&P ch. 20).
The software-testing work (from 12 Nov 2026) adds a **DevOps/CI lifecycle** on top:

| Stage | When | What runs | Gate |
|---|---|---|---|
| Write code (TDD for fixes) | each change | failing test first, then fix (`git log --oneline`: every `test: … (red)` is followed by `fix: … (green)`) | the new test passes |
| Commit / merge request | every push | lint, unit + property + integration tests, coverage thresholds (CI stage `test`) | all green, lines ≥ 90%, branches ≥ 80% |
| Pipeline (heavier) | every push to main, nightly | browser system + acceptance tests, accessibility audit, mutation testing (CI stages `system`, `mutation`) | system green; mutation score ≥ 60% (break) |
| Before release | manually / weekly | performance & stress (QR1/QR2), offline A/B of the matcher (QR3) | p95 ≤ 1 s at 100 users; accuracy ≥ 85% |
| Operation | continuously | `GET /metrics` (handler errors, recompute time, event-loop delay), beta usability study | alerts on handler errors > 0/day, p95 recompute > 250 ms |

TDD was used for every defect found during testing (D1–D9): the red test run is kept in `reports/test-runs/`
or `reports/system/`, and the fix is a separate commit. The plan evolved as testing found things: e.g. D6 showed
the fuzzers' input generators were too narrow (no `{"toString":{}}` objects), so they were extended; D9 was only
found because the usability measurements were run on a phone-sized device as well.

## 2. Priorities and what each requirement needs

Priority follows risk (likelihood × impact) and the Y&P ch. 3 principles: high-priority requirements get **two
independent approaches** (redundancy), and are pushed **early** (unit level) where possible (ch. 4).

| Req | Priority & reason | Approaches (≥ 2 for H) | Needs | Earliest stage |
|---|---|---|---|---|
| SR4 robustness | H: one bad message took the whole server down (D1, D4), ending every call | fuzzing every socket event + HTTP route; crash oracle in every integration test; fault injection; code review of input handling | crash oracle, fuzz generators, metrics counter | integration |
| SR1, FR1 adults only | H: legal/app-store requirement | unit boundary tests; property test with independent age oracle; system test of the form | controllable "today" | unit |
| FR7, SR2 safety | H: harassment harms users | unit category partition; integration (sockets); acceptance US-3 in browsers | in-memory DB, admin email capture | unit |
| FR2/QR3 matching | H: the product's core value | unit partitions; properties; offline A/B with statistics; acceptance US-1/US-4 | labelled pairs, embedding model | unit |
| FR3 preferences | H: wrong filter shows people who opted out | pairwise suite with independent oracle; integration over sockets | pairwise generator | unit |
| PR1 privacy | H: personal data | integration (payload contents); acceptance US-2 (screen text) | two browsers | integration |
| QR1/QR2 latency | M→H: realtime product, but N is small today | load/stress with metrics; review of the O(N²) recompute | load generator, operational profile, server metrics | system |
| FR5, FR6, SR3 | M | model-based FSM; decision table; boundaries | controllable clock | unit |
| QA-ACC1, QA-U1 | M | axe audit; KLM metrics; heuristic evaluation; usability study (validation) | browsers, screenshots, participants | system |

## 3. Scaffolding

| Scaffolding | File | What it lets us test | Justification |
|---|---|---|---|
| In-memory DB + memory mail, server in the test process | `test/support/helpers.js`, `db-fixture.js` | integration tests in ~100 ms each, isolated per file (node:test runs each file in its own process) | real SQLite (no mock) so SQL is tested too |
| Crash oracle | `helpers.js` `crashes[]` + `stop()` | any uncaught server exception fails the test file | node:test turned crashes into warnings, hiding D4 (see test-log) |
| Controllable clock | `db-fixture.js` `atTime()` | 7-day / 48 h / 24 h / 10 s boundaries without waiting | every time window has an exact boundary test |
| Direct account fixture | `db-fixture.js` `makeUser()` | unit tests of DB modules without HTTP | separates unit from integration level |
| Pairwise generator + oracle | `test/support/pairwise.js` (self-checked by `missingPairs`) | 2.2 M preference combinations in < 60 cases | a tool's own oracle: the generated suite is checked to cover all pairs |
| Executable FSM model | `test/unit/background.fsm.test.js` `model()` | random command sequences vs. the implementation | model-based testing (ch. 14) |
| Fuzz generators | `test/property/socket-fuzz.test.js` | arbitrary payloads to all 39 socket events and 8 HTTP routes | the 39-event list is itself checked against `server.js` |
| Separate-process server + email link reader | `test/support/server-process.js` | black-box system/acceptance/perf tests with no test-only routes in the app | keeps the product free of test backdoors |
| Two browsers with fake camera/mic | `playwright.config.js`, `test/support/ui.js` | real WebRTC calls headless, desktop + phone | system tests must see what users see |
| Synthetic operational profile | `test/performance/profile.js` | realistic mix of activities, typos, other languages for load | no production data available (limitation) |
| Labelled pairs | `test/ab/pairs.js` | statistical matcher quality | oracle for an ML component |

## 4. Instrumentation

Added in commit `2ae3193` (`metrics.js`, `GET /metrics` behind `METRICS_TOKEN`):

| Instrument | Requirement it makes observable | Used by |
|---|---|---|
| `recompute.ms` timing (p50/p95/p99 of the last 2000 passes) | QR1/QR2: server share of match latency | `test/performance/match-latency.js` |
| event-loop delay p99 (`perf_hooks`) | QR2: first sign of overload in Node | performance report |
| `socket.handler_error[.event]` counters | SR4: the error boundary (D4) firing in production | `instrumentation.test.js` (fault injection) |
| `socket.in.<event>`, `socket.rejected.<reason>` | SR4, FR1: traffic and refused connections (unverified, unauthorized) | operations, tests |
| funnel counters `requests.sent/accepted/declined`, `rooms.opened.*` | QA-U1 in operation; the online A/B metric (acceptance rate) | docs/ab-testing.md |
| `auth.login.ok/failed`, `auth.register.invalid` | SR3 (brute force), FR1 (form friction) | operations |
| existing: `SIGUSR2` dump of live state, `[conn]` logs | debugging | — |

The instruments are themselves tested (`test/integration/instrumentation.test.js`): token check, counter
increments over a real match, percentile maths, ring-buffer size, and fault injection into `chat.send`.

## 5. Risks and mitigations (Y&P ch. 20)

| Risk | Likelihood / impact | Mitigation in this plan |
|---|---|---|
| The synthetic load profile is unrepresentative, so QR1 passes in test but fails live | M / H | step load far past the target (to 800) to find the envelope; production metrics give the real profile later |
| Labelled pairs reflect one person's judgement | H / M | report Wilson intervals; plan inter-rater labelling; online A/B to validate |
| Flaky browser tests (timing, WebRTC) erode trust in CI | M / M | explicit waits on state, retries = 1 in CI only, traces kept on failure |
| Embedding model (280 MB) unavailable in CI | H / L | socket tests run with `EMBEDDINGS=off`; model tests are a separate job with a cache |
| Tests pass because the oracle is blind (as with node:test hiding crashes) | M / H | mutation testing; crash oracle; tests of the instruments |
| Single developer = no independent tester | H / M | system tests written from requirements, not code; review checklist (docs/code-review.md) |
| Time: ~40 h available | H / M | priorities above; lower-priority areas (group rooms UI, scheduling UI) left to integration tests |

## 6. Entry and exit criteria

- Entry: the requirement has an ID and an oracle in requirements.md.
- Exit (per change): CI green; coverage thresholds met; no new mutant survivors in the module changed without a note.
- Exit (release): all H requirements have ≥ 2 passing approaches; QR1 met; no serious accessibility violations; known
  defects logged in test-log.md with a decision.

## 7. Evaluation of this plan (strengths, omissions, vulnerabilities)

- **Strong:** every H requirement has at least two independent approaches (e.g. SR4: fuzzing + crash oracle + review);
  defects were found at three levels (unit D2/D3/D5/D6, integration D1/D4, system D7/D8/D9), which suggests the levels
  are complementary; the instruments are tested.
- **Omitted:** group rooms (up to 5) are only tested at integration level, not in browsers; the scheduling/Connects UI,
  admin page (`public/admin.*`) and email delivery through a real SMTP server have no system tests; no security testing
  beyond robustness (no CSRF/XSS scanner, no dependency audit in CI); no test of the database migrations in `db.js`
  against an old database file (branch coverage of `db.js` is the lowest).
- **Vulnerable:** QR1 depends on the synthetic profile; QR3 on one labeller; usability validation depends on recruiting
  participants, which was not done in the time available (protocol ready in acceptance/usability-study.md).
- **What would change with more time:** browser tests for group rooms and Connects; a migration test with a saved v1 DB;
  OWASP ZAP baseline scan in CI; nightly soak test watching memory (the in-memory maps in server.js never shrink if
  sockets leak).
