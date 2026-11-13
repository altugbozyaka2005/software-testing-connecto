# Category partition: `safety.createReport` (FR7, SR2, SR3)

Independently testable feature: filing a report. Steps as in Y&P ch. 11 (and the course's PillDrone example).

## Parameters and environment, with value classes

| Category | Value classes | Constraint |
|---|---|---|
| reporter vs reported | different people; same person | same → [error] |
| reason | each of the 7 listed reasons; unknown string (`'rude'`, `'SPAM'`, `''`); non-string (`null`, `42`, `['spam']`, `{}`); inherited object key (`'constructor'`, `'__proto__'`, `'toString'`) | non-listed → [error] |
| details | absent / whitespace only; normal text with newlines and tabs; > 500 characters | [single] for > 500 |
| transcript | none; ≤ 100 messages; > 100 messages | [single] |
| reporter's reports in the last hour (env) | 0–9; exactly 10 (limit); older than 1 h | 10 → [error] |
| open report from this reporter about this person (env) | none; exists | exists → update, [single] |
| distinct reporters about this person in 24 h, incl. this one (env) | 1–2; exactly 3; ≥ 4 (already suspended); 3 but one older than 24 h | |
| admins configured (env) | yes; no | [single] |

## Test case specifications (implemented in `test/unit/safety.test.js`)

| Id | Combination | Expected |
|---|---|---|
| TS-REP-1 | each listed reason, fresh pair | `{ ok: true, autoSuspended: false }` |
| TS-REP-2 [error] | unknown and non-string reasons | "Choose a reason", nothing stored (found D2 for `['spam']`) |
| TS-REP-3 [error] | inherited keys | refused, nothing stored (D2) |
| TS-REP-4 [error] | reporter = reported | "can't report yourself" |
| TS-REP-5 | details whitespace / > 500 / blank | collapsed, cut at 500, blank → NULL |
| TS-REP-6 [single] | second report, same pair | one row, updated |
| TS-REP-7 [single] | 130-message transcript | last 100 kept |
| TS-REP-8 | 10th, 11th report in 1 h; then after 1 h | accepted, refused, accepted |
| TS-REP-9 | 2nd and 3rd distinct reporter | not suspended / suspended + admin email marked [Auto-suspended] |
| TS-REP-10 | same reporter twice + one more | counts as 2, not suspended |
| TS-REP-11 | 2 reporters, 3rd after 24 h + 1 ms | not suspended |
| TS-REP-12 | 4 reporters | suspended once, sessions deleted, handler called once |

Without the error/single constraints the categories give 2 × 10 × 3 × 3 × 3 × 2 × 4 × 2 = 8,640 combinations; with them, 12 cases.
