# Connecto: requirements and test strategy (LO1)

Connecto asks "What are you doing right now?", matches people doing similar things in real time and
puts them into a video, voice or chat room when a request is accepted (README.md has the architecture).
This document is the test basis: the requirements I chose to test, their type and level, how each is
tested, and how appropriate that approach is. The IDs are used in test names, so `grep -rn "D4\|SR4" test/`
finds the evidence for a requirement.

## Stakeholders and what they care about

| Stakeholder | Cares about | Requirements |
|---|---|---|
| Person looking for company (primary user, 18+) | finding someone *now*, little effort, the right person | FR2, FR3, QR1, QR3, QA-U1, US-1, US-4 |
| Person being matched | privacy, not being harassed, being able to say no | PR1, FR7, SR3, US-2, US-3 |
| Moderator / admin (ADMIN_EMAILS) | reports reach them, abusers removed quickly | FR7, SR2 |
| Operator (runs the VPS) | the server stays up, costs and capacity are known | SR4, QR1, QR2 |
| Users with disabilities | can use every core screen | QA-ACC1 |
| Regulator / app stores | adults only, data minimisation | SR1, PR1 |

## Requirements

Type: **F** functional (safety / correctness / liveness), **Q** measurable quality attribute, **S** security/robustness,
**P** privacy, **U** qualitative (usability, accessibility). Level: where the requirement is first observable
(U unit, I integration, S system). Priority H/M/L drives effort (docs/test-plan.md section 2).

| ID | Type | Level | Pri | Requirement (test basis) | Oracle / measure |
|---|---|---|---|---|---|
| FR1 | F correctness | U, S | H | Accounts need first/last name (letters, 1–50), valid email (≤ 254), password 8–128 with a letter and a digit, date of birth, acceptance of the guidelines; the email must be confirmed before matching. | field errors per rule; unconfirmed sockets refused |
| SR1 | F safety | U, S | H | Nobody under 18 can register (18th birthday today is allowed, tomorrow is not); ages over 120 are refused. | date arithmetic oracle independent of `ageOn` |
| FR2 | F correctness | U, I, S | H | Similar activities score high and unrelated ones below the match threshold (0.15); identical wording scores ≥ 0.95 in any script; scores are symmetric and in [0,1]. | labelled pairs; properties |
| FR3 | F correctness | U, I | H | Match preferences are mutual: two people see each other only if each fits the other's gender/age/country/language filters and they share a call mode; the call uses the richest shared mode. | independent oracle restating the rule |
| FR4 | F liveness | I, S | H | A request → accept puts both people in the same room; leaving returns the other to matching (system "returns to ready"). | room-start/room-ended events; UI screens |
| FR5 | F correctness | U | M | Background connect requests follow the state machine in docs/test-specs/connect-request-fsm.md (pending 7 days, accepted 48 h or until 2 h after a scheduled meeting). | executable model |
| FR6 | F correctness | U, I | M | Direct messages only between connected or befriended, unblocked people; 1–2000 characters. | decision table |
| FR7 | F safety | U, I, S | H | Users can report (7 reasons) and block from a match, call or chat; blocking hides both people from each other and ends any call. | DB rows, events, UI |
| SR2 | F safety | U | H | Reports from 3 different people within 24 h suspend an account automatically and sign it out everywhere; admins are emailed. | boundary tests at 2/3 reporters, 24 h |
| SR3 | S abuse | U | M | Rate limits: ≤ 10 reports/hour, ≤ 20 connect requests/day (cancelling does not reset it), ≤ 15 DMs/10 s and 1000/day. | boundary tests |
| SR4 | S robustness | I, S | H | No input a client can send (HTTP body, cookie, socket payload) can stop the server or produce a 5xx; failures answer with an error. | crash oracle + fuzzing |
| PR1 | P | I, S | H | Other people only ever see first name + last initial, never surname, email or date of birth. | text of every screen a stranger sees |
| SR6 | S | U | L | TURN credentials are HMAC-signed and expire after 12 h. | independent HMAC |
| FR8 | F | U | L | Emails escape user-supplied text in HTML and show times in the recipient's time zone. | rendered email |
| QR1 | Q performance | S | H | With 100 people searching, when someone changes activity every searching person gets an updated list within 1 s at the 95th percentile. | fan-out latency, p95 + bootstrap CI |
| QR2 | Q capacity | S | M | Find the operational envelope: the number of concurrent searchers at which QR1 stops holding (target ≥ 400 on one 1.5-CPU container). | load steps until p95 > 1 s |
| QR3 | Q matching quality | I | M | On a labelled set of activity pairs, the production matcher reaches ≥ 85% accuracy and is not worse than the word-only fallback. | offline A/B, McNemar |
| QA-ACC1 | U accessibility | S | M | No critical or serious WCAG 2.1 AA violations on the main screens; everything on the sign-in screen works with the keyboard. | axe-core; keyboard walk |
| QA-U1 | U usability | S | M | Shortest path: sign-up → matches ≤ 6 clicks and ≤ 60 s predicted (KLM), match → call 1 click per person, report+block ≤ 3 clicks; real users: SUS ≥ 68 and ≥ 80% task completion unaided. | KLM; usability study |
| US-1..4 | user stories | S | H | Acceptance criteria in test/acceptance/stories.spec.js: find & call (US-1), privacy (US-2), report & block (US-3), unrelated people not offered (US-4). | Given/When/Then in two browsers |

## Levels: how the requirements decompose

- **Unit:** the rules live in small modules that can be tested alone: `matcher.js` (FR2), `prefs.js` (FR3),
  `auth.js` validators (FR1, SR1), `background.js` (FR5), `chat.js`/`friends.js` (FR6), `safety.js` (FR7, SR2, SR3).
- **Integration:** the realtime layer (`server.js`) composes them over Socket.IO with the database and mail;
  integration tests drive real sockets against the in-process server (FR3 over sockets, FR4, FR7, SR4).
- **System:** only the whole system shows latency (QR1, QR2), the UI journey (FR4), privacy on screen (PR1),
  accessibility and usability (QA-ACC1, QA-U1) and the user stories.

## Test approach per requirement and why

| Requirement | Approach (technique, Y&P chapter) | Why this approach |
|---|---|---|
| FR1, SR1 | boundary-value analysis + category partition (ch. 10–11); property-based check against an independent age calculation | the rules are numeric limits; faults cluster at boundaries (off-by-one around the 18th birthday) |
| FR2 | category partition of input kinds; properties (symmetry, range, idempotence); offline A/B on labelled pairs with statistics | the matcher is partly ML: no exact oracle for "similar", so test laws it must obey plus statistical quality on a labelled set |
| FR3 | pairwise combinatorial testing (ch. 11) with an independent oracle; boundary values of age bands | 10 interacting parameters (2.2 M combinations); most faults involve one or two parameters |
| FR5 | model-based testing of a finite state machine (ch. 14): transition coverage + random walks against an executable model | behaviour depends on history and time; a model covers sequences hand-written tests miss |
| FR6, SR3 | decision table; boundaries of rate limits with a controllable clock (scaffolding) | conditions combine (connected × friends × blocked × self); limits are time windows |
| FR7, SR2 | category partition of report inputs; boundary tests at 2/3 reporters and 24 h | high-priority safety rule with thresholds |
| SR4 | fuzzing / property-based robustness testing of every socket event and HTTP route; fault injection | the input space is unbounded and adversarial; random structured inputs find what partitions miss |
| PR1, FR4, US-* | system tests and acceptance tests in real browsers (Playwright), two users | only visible end-to-end; independent of the implementation (ch. 22) |
| QR1, QR2 | load/stress testing with a synthetic operational profile; instrumentation (metrics) | global property, only measurable on the whole running system |
| QA-ACC1 | automated WCAG audit (axe-core) + manual keyboard check | standards-based checklist; automation finds ~30–40% of issues |
| QA-U1 | factored usability (ch. 22.4): automated KLM/click counts (verification) + a planned usability study with users (validation) | usability is ultimately validated with people; the automated part catches regressions in task length |
| all | mutation testing (ch. 16) to judge the unit suites; coverage (ch. 12) as a minimum | coverage says what ran, mutation says what the assertions would notice |

## Appropriateness and limitations

- **Matching quality (FR2/QR3) has no ground truth.** "Similar" is a human judgement; the labelled pairs are mine
  (one labeller, 95 pairs) and English-heavy, so the accuracy estimate is optimistic for other languages and
  has a wide confidence interval. Better: several labellers and Cohen's kappa, pairs sampled from real usage.
- **Performance (QR1/QR2) uses a synthetic operational profile.** There is no production usage data in this copy, so
  the activity mix, the arrival pattern (one change at a time) and running on a laptop rather than the 1.5-CPU
  container are assumptions. The test runs with `EMBEDDINGS=off`; the model adds ~5–40 ms per new activity.
- **WebRTC media quality is not tested.** Calls are checked to connect with fake devices on one machine; NAT
  traversal through TURN, bandwidth and audio/video quality need real networks (beta test).
- **Usability and accessibility automation only verifies.** KLM predicts expert time on the shortest path; it says
  nothing about whether people *understand* the screens. That needs the study in docs/acceptance/usability-study.md.
- **Security** is tested for robustness (crashes, validation, rate limits); no penetration testing, dependency audit
  or review of the WebRTC signalling for impersonation was done (docs/evaluation.md, gaps).
- **Email delivery** is tested via an in-memory/console transport, not a real SMTP provider.
