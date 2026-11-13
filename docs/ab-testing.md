# A/B testing of the matcher (QR3, FR2)

A/B testing compares two variants of the same feature on the same population and decides statistically
whether one is better. (It is different from mutation testing, which judges the *tests*: see
[evaluation.md](evaluation.md) section 3.) Here it judges the matcher, the part of Connecto that is an ML
component and has no exact oracle.

## 1. Offline A/B (done): `npm run test:ab` → `reports/ab/matcher-ab.md`

- **Variants.** A = word matching only (`lexical`: categories, keywords, trigrams), which is what users get
  whenever the embedding model is unavailable; B = production `score` = max(word, meaning) with the local
  multilingual model.
- **Population.** 96 labelled activity pairs in `test/ab/pairs.js` (53 should match), in 8 kinds: same words,
  paraphrase, slang, typo, cross-lingual (Turkish, Spanish, French, German, Japanese, Russian) and three kinds of
  non-match (shared word, same broad area, unrelated). The labelling rule was written before running either variant.
- **Decision rule.** Predicted match if score ≥ 0.15 (the server's threshold). Paired design: both variants score the same
  pairs, so the **exact McNemar test** on disagreeing pairs is the right test; rates get **Wilson 95% intervals**.

| | A: words only | B: words + meaning |
|---|---|---|
| accuracy | 0.573 [0.473, 0.667] | **0.740** [0.644, 0.817] |
| recall (should-match pairs found) | 0.642 | **0.962** |
| specificity (non-matches rejected) | 0.488 | 0.465 |
| cross-lingual pairs correct | 1 / 14 | **14 / 14** |

McNemar: of 18 pairs where they disagree, B alone is right on 17, A alone on 1, **p = 0.00015**. B is better,
almost entirely through recall (paraphrases, other languages). QR3 (accuracy ≥ 0.85) is **not met**.

**Diagnosis.** Both variants reject only ~1 in 2 non-matches. 23 of B's 25 errors are false matches such as
"playing chess" ~ "playing football" (0.7) or "studying calculus" ~ "studying history" (0.7). The cause is in the
word scorer, not the model: generic verbs (`play`, `watch`, `learn`, `train`…) are category triggers, and any shared
category forces a score ≥ 0.3 + 0.4 × overlap (code review R7). Raising the threshold cannot fix it (accuracy B is
0.74–0.77 for thresholds 0.1–0.5).

**Candidate C (exploratory, not deployed):** the same signals without the category floor, combined with meaning,
threshold chosen on these pairs: accuracy 0.823 [0.735, 0.886], specificity 0.72; McNemar B vs C p = 0.057.
Because C's threshold was tuned on the evaluation pairs (no hold-out) this is optimistic, and the difference is not
significant at 5%. It is still below 0.85.

**Limitations.** One labeller; 96 pairs (wide intervals: ±0.09 on accuracy); pairs written by me rather than sampled
from real prompts; "should these two people talk" is partly subjective (two people studying different subjects may
well want a silent study session together, so some "same area" labels are debatable).

## 2. Online A/B (designed, needs production traffic)

- **Unit of randomisation:** account (hash of id → arm), so a person always sees one variant; both people in a pair
  are scored by the *viewer's* arm.
- **Arms:** current B vs candidate C.
- **Primary metric:** share of match requests that are accepted (instrumented: `requests.sent` / `requests.accepted`
  in `metrics.js`; per-arm counters would be added). Guardrails: reports per call, time to first match, matches shown.
- **Sample size:** to detect 30% → 35% acceptance (α = 0.05 two-sided, power 0.8): **1,377 requests per arm**
  (computed in `test/ab/matcher-ab.js`). At current traffic this is a long test; a sequential design or a larger
  minimum detectable effect would shorten it.
- **Ethics/privacy:** no new personal data; activities are already processed by the matcher; arm assignment logged
  with the account id only.
