# Evaluation of the testing process (LO4)

What the testing in [test-log.md](test-log.md) does and does not establish, the targets it was measured
against, and what it would take to reach them. Numbers are from 13 Nov 2026 runs; files under `reports/`.

## 1. Gaps and omissions (4.1)

| Gap | Effect | Remedy |
|---|---|---|
| **No real users yet** for the usability study ([protocol](acceptance/usability-study.md)) | usability is verified (KLM, axe, heuristics) but not validated; H1–H3, H5 unconfirmed | run the 13-participant study; recruitment and time were the constraint |
| **Matching quality oracle**: 96 pairs labelled by one person, written not sampled | QR3 estimate has ±0.09 width and unknown labeller bias; "same area" labels debatable | 2–3 labellers, Cohen's κ, pairs sampled from (anonymised) real prompts, hold-out split |
| **Synthetic operational profile** for load; laptop not the 1.5-CPU container; one change at a time | QR1/QR2 numbers are optimistic about bursts and slower hardware; embeddings off | replay production `/metrics` traffic; run perf job in the container limits; burst arrivals |
| **WebRTC** tested only with fake devices on one machine | NAT traversal (TURN), bandwidth, audio/video quality untested | beta test (Y&P: real users, uncontrolled environment) with the `[conn]` logs |
| **Browser coverage of features**: group rooms, Connects/DMs, scheduling, admin page, filters dialog | only integration-tested; UI faults there (like D7–D9) would be missed | extend `test/system` with the same two-browser pattern |
| **Cross-browser**: only Chromium (desktop + phone emulation) | Safari/Firefox WebRTC and CSS differences untested | add Playwright `webkit`/`firefox` projects to the system job |
| **Mutation scope** excludes `server.js` (orchestration) and `auth.js` routes | assertion strength there is unknown; `server.js` also has the lowest branch coverage | run Stryker on `server.js` with the integration suite nightly (slow: ~2 s per mutant) |
| **Security** beyond robustness | no XSS/CSRF scanner, dependency audit, signalling-impersonation review | `npm audit`, OWASP ZAP baseline in CI, review of `signal` relay |
| **Database migrations** in `db.js` | lowest branch coverage of all files: the old-schema branches never run | test that opens a saved v1 database file |
| **Time-dependent cleanup** (`setInterval` jobs) | the hourly/5-minute cleanups are not exercised | export the cleanup functions and call them under `atTime` |

## 2. Targets and why (4.2)

| Measure | Target | Justification |
|---|---|---|
| Line / branch coverage (all server modules) | ≥ 90% / ≥ 80% (CI gate) | a floor, not a goal (Y&P ch. 9: coverage only shows what ran); the existing suite already had 93/79, so the gate prevents regressions |
| Branch coverage of safety modules (`safety.js`, `background.js`, `chat.js`, validation in `auth.js`) | ≥ 90% | high-priority requirements (SR2, SR3, FR7); error branches are where D2/D5 were |
| Mutation score (8 domain modules) | ≥ 70% overall, ≥ 80% in `safety.js`, `prefs.js`, `matcher.js` | Stryker's default "low" is 60%; these modules decide who sees whom and who is suspended, so stronger assertions are expected there; equivalent mutants make 100% unreachable |
| Robustness (SR4) | 0 crashes; ≤ 1 crash per 1000 hostile messages with 95% confidence | a crash ends every call; the rule of three gives the bound from failure-free trials |
| QR1 match-update latency | p95 ≤ 1 s with 100 searchers | "right now" product; 1 s is the usual limit for an interaction to feel uninterrupted |
| QR2 envelope | QR1 still met at ≥ 400 searchers | 4× the expected peak of the current deployment |
| QR3 matcher accuracy | ≥ 0.85 on labelled pairs; B not worse than A | a wrong match wastes a request; 0.85 ≈ fewer than 1 in 6 cards irrelevant |
| QA-ACC1 | 0 critical/serious axe violations; keyboard walk passes | WCAG 2.1 AA is the level EN 301 549 (the European accessibility standard) refers to |
| QA-U1 | clicks/KLM per task as in requirements.md; SUS ≥ 68; completion ≥ 80% | SUS 68 is the cross-industry average; KLM limits from the task design |

## 3. Achieved versus targets (4.3)

| Measure | Target | Achieved | Met? |
|---|---|---|---|
| Line / branch coverage | 90 / 80 | 95.01 / 89.69 (from 93.44 / 79.34 at the start) | yes |
| Branch coverage of safety modules | ≥ 90 | safety 97.6, background 97.6, chat 96.1, auth 93.9 (safety.js was 83.3 before `admin.test.js`) | yes |
| Mutation score overall | ≥ 70% | run 1: 56.8% → run 2: **75.3%** (same 1,994 mutants); without the matcher's vocabulary tables 65.8% → **87.4%** [95% Wilson 85.8, 88.9] | yes (run 2) |
| Mutation score safety / prefs / matcher | ≥ 80% | prefs 96.2%, matcher logic 93.2% (42.9% incl. vocabulary data), safety **79.0%** | prefs, matcher yes; safety just below |
| Robustness | 0 crashes | 0 crashes in 1,180 fuzzed messages to the server (after D1/D4/D6); 95% upper bound 0.25% per message | yes, but for the fuzz distribution, not real traffic |
| QR1 | p95 ≤ 1 s @ 100 | 131 ms (95% bootstrap CI 130–132) | yes |
| QR2 | QR1 holds @ 400 | holds @ 800: p95 251 ms; recompute p95 26 → 188 ms from 100 → 800 (super-linear, R11) | yes; edge not reached |
| QR3 | ≥ 0.85, B ≥ A | B 0.74 [0.64, 0.82]; B > A (McNemar exact p = 0.00015) | **no** (accuracy) / yes (B ≥ A) |
| QA-ACC1 | 0 serious | 22 serious before (D8), 0 after on 8 screens; keyboard walk passes | yes (automated part) |
| QA-U1 (automated) | T1 ≤ 6 clicks/60 s, T2 1 click/5 s, T3 ≤ 3 clicks/10 s | T1 3 clicks + 6 fields, 48.7 s; T2 1 click, 2.7 s; T3 3 clicks, 8.0 s (desktop and phone) | yes |
| QA-U1 (users) | SUS ≥ 68, completion ≥ 80% | not run | **not measured** |

Why the variations: QR3 fails because of false matches from the word scorer's category floor (R7), not the model
(specificity 0.47 for both variants); the threshold cannot fix it (sweep in `reports/ab/matcher-ab.md`). The latency
targets are met by a wide margin partly because the 120 ms debounce dominates and the test machine is faster than
production.

**Mutation testing, run 1 → run 2** (`reports/mutation/run1/` → `reports/mutation/`). Run 1 scored 56.8% although
line coverage was 94.7%: the code ran, but the assertions would not have noticed many changes. The survivors were
analysed (`reports/mutation/run1/mutation.json`) and fell into four groups:
1. **Vocabulary data** (267 of matcher's 306): deleting one trigger word such as `'chess'` from `CATEGORIES` is not
   noticed. These test the word list, not the logic; the list's adequacy is measured by the A/B, so they are reported
   separately rather than killed with one tautological test per word.
2. **Real test weaknesses:** time windows tested on one side only (a 24 h window shrunk to 86 s survived because the
   test only checked *after* 24 h); score assertions that were thresholds only (`>= 0.5`), so the blend weights and
   even turning cosine's `/` into `*` survived behind the `min(1, …)` clamp; a **tautological oracle**
   (`parse(null)` compared with `{ ...DEFAULTS }`, the module against itself); unanchored-regex cases never tried
   (`a@b.cc@d`, `x1995-06-15`); normalised values never asserted (blank bio → `null`).
3. **Code only integration tests reached** (no coverage in the unit suites): background-search start/stop, token and
   session lifetimes, the admin router.
4. **Equivalent mutants** that no test can kill, e.g. the stemmer's `ies → i` rule always gives the same result as the
   next `es` rule ("studies" → "studi" either way): dead code (added to the review as an observation), plus
   performance-only `break`s and short-circuit operators with identical results.

Group 2 and 3 were addressed by `test/unit/mutation-driven.test.js` (MK-1…24: exact hand-computed scores, both sides of
every window, literal oracles, anchors), background-search unit tests and `test/integration/admin.test.js`.
safety.js stays at 79.0%: most of its remaining survivors are the admin-email wording and `?.` guards on maps that
are always initialised (near-equivalent).

## 4. What would be needed to reach or exceed the targets (4.4)

- **QR3:** change the word scorer so generic verbs do not trigger categories, or drop the category floor when meaning
  vectors are available. Candidate C does the latter: 0.82 accuracy, specificity 0.72, but tuned on the same pairs
  (optimistic) and not significantly better than B (p = 0.057). To decide properly: ~300 pairs from 3 labellers
  (κ ≥ 0.6), a held-out half for the final number, then the online A/B in [ab-testing.md](ab-testing.md)
  (1,377 requests per arm to detect 30% → 35% acceptance).
- **Mutation:** safety.js to ≥ 80% needs assertions on the admin email body and a decision on the `?.` guards
  (remove them if they can never be undefined, which also removes the equivalent mutants); extend the scope to
  `server.js` with the integration suite (≈ 2 s per mutant, a nightly job of a few hours) or split server.js so its
  logic can be unit tested (R14). Mutation testing in CI takes ~80 min, so it runs nightly/on main, not per push.
- **Usability validation:** run the study (13 participants, ~1 h each, ~15 h including analysis); fix H1 (stale toasts over the call controls) first.
- **Coverage of the gaps in §1:** browser tests for group rooms and Connects (~4 h), migration test (~1 h), cleanup jobs under a fake clock (~1 h),
  Safari/Firefox projects (~1 h plus fixing what they find).
- **Confidence in QR1/QR2 for production:** run the perf job inside the production container limits and with burst arrivals; after launch, compare with
  `/metrics` (recompute p95, event-loop delay) and alert when recompute p95 > 250 ms.
