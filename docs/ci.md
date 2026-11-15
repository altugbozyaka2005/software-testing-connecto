# CI pipeline (LO5.2–5.4)

Two equivalent definitions: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (GitHub Actions, where this
repository is hosted) and [`.gitlab-ci.yml`](../.gitlab-ci.yml) (University GitLab, the course default).

## 5.2 Design

```
push / merge request ──▶ static ──▶ test ──┬──▶ system ───────────────▶ (artifacts: Playwright report,
                          lint      unit     │    browsers, desktop+phone      accessibility, usability metrics)
                                    property ├──▶ mutation  (main + nightly) ▶ (artifact: mutation.html; breaks < 60%)
                                    integr.  └──▶ perf + A/B (weekly / manual) (artifacts: latency.md, matcher-ab.md)
                                    coverage
```

| Stage | Runs | Why here | Typical time |
|---|---|---|---|
| static | `node --check` on every server module | cheapest possible failure first | < 1 min |
| test | unit + property + integration (190 tests) with c8 thresholds (lines ≥ 90%, branches ≥ 80%); JUnit + Cobertura reports | every push: fast (≈ 6 s of tests) and catches most defects (D1–D6, D10 were found at these levels) | ≈ 2 min incl. `npm ci` |
| system | Playwright: system journeys, user-story acceptance tests, axe audit, usability metrics; desktop + Pixel 7 | needs browsers; slower; found D7–D9 | ≈ 3 min |
| mutation | Stryker on 8 domain modules (1,994 mutants) | too slow for every push; nightly and on main keeps the suites honest | ≈ 2 h on GitHub's runner |
| perf / A/B | latency stress test and matcher A/B | noisy on shared runners (results are indicative, not a gate); weekly trend + on demand | ≈ 10 min |

Design decisions: the 280 MB matching model is cached between runs (key never changes unless the model does);
socket tests run with `EMBEDDINGS=off` so only `semantic.test.js` and the A/B depend on the model; browser tests get
one retry in CI only (WebRTC timing), and keep a trace on failure for diagnosis; no deployment stage, since this
testing copy deliberately has no deploy script (README).

## 5.3 What is automated, and what the pipeline would catch

| Kind of issue | Caught by | Example from this project |
|---|---|---|
| crash on hostile input | test (fuzzing + crash oracle) | D1, D4, D6 would fail the `test` job |
| broken business rule at a boundary | test (unit) | D5 (request limit), D2 (report reasons), age 18 boundary |
| matching regression | test (unit + properties), perf/A-B (quality trend) | D3; a change to `CATEGORIES` that lowers A/B accuracy |
| UI journey or layout broken | system | D7, D9; a renamed button breaks ST-1/US-1 |
| accessibility regression | system (axe) | D8; a new low-contrast colour |
| weaker tests (assertions deleted) | mutation | score drops below 60% → job fails |
| coverage drop | test (c8 thresholds) | new untested module |
| performance regression | perf (manual gate) | recompute p95 doubling at 100 users |

Not automated: the usability study with people, code review (done by hand, docs/code-review.md), security scanning
(proposed: `npm audit --audit-level=high` and an OWASP ZAP baseline scan as an extra stage).

## 5.4 Evidence that the pipeline works

1. **The exact `static` + `test` stage commands in a clean `node:24` container** (the image `.gitlab-ci.yml` uses), from
   a `git archive` of the committed code: lint passes, 163/163 tests, coverage 94.74% lines / 88.22% branches, JUnit
   and Cobertura files produced. Log: [`reports/test-runs/ci-local-docker-node24.txt`](../reports/test-runs/ci-local-docker-node24.txt).
2. **The pipeline fails when it should:** the red commits (`690da25`, `040bd21`, `343f218`, `8bc0328`, `a2ccd56`,
   `9b7c669`, `512121d`) each contain a test that fails on the code at that commit, with the saved run logs listed in
   test-log.md. Re-running the pipeline at those commits would fail the `test` or `system` job; at the following
   `fix:` commits it passes.
3. **Both YAML files parse** and define the jobs above (checked with PyYAML).
4. **Real GitHub Actions run** on the push of 13 Nov 2026:
   <https://github.com/altugbozyaka2005/software-testing-connecto/actions/runs/43352903322> (log saved in
   [`reports/test-runs/github-actions-run-1.txt`](../reports/test-runs/github-actions-run-1.txt)):
   `static` ✓, `test` ✓ (190 tests, coverage gates), `system` ✓ (17 Playwright tests in Ubuntu, desktop + phone),
   `perf` skipped (not scheduled), **`mutation` cancelled** at the 45-minute job limit. Diagnosis: once
   `admin.test.js` joined the mutation test set (it imports every module, so Stryker runs it for most mutants) a
   run takes well over 45 min on the hosted runner. Fix: `timeout-minutes: 120`. The pipeline behaved as designed; the
   failure was in its configuration, and is itself an example of the pipeline reporting a problem.
5. **After the fix**, GitHub Actions run 2 on 15 Nov 2026:
   <https://github.com/altugbozyaka2005/software-testing-connecto/actions/runs/43735276129> (log saved in
   [`reports/test-runs/github-actions-run-2.txt`](../reports/test-runs/github-actions-run-2.txt)): **all jobs green**:
   `static` ✓ (19 s), `test` ✓ (30 s; 190 tests, coverage gates), `system` ✓ (2 min 15 s; 17 Playwright tests),
   `mutation` ✓ (1 h 57 min; **score 75.54%**, above the break threshold of 60, matching the local 75.3%), `perf`
   skipped (weekly/manual). The mutation job took 116 of its 120 minutes, which is too little headroom, so the limit
   was raised to 180 min (GitLab: 3 h) in the commit that records this run.
