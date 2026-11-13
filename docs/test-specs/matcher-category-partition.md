# Category partition and boundaries: `matcher.js` (FR2)

## `stem(word)`: boundary values of each suffix rule (BV-STEM-1..6)

| Rule | Boundary | Tests (just above / on / below) |
|---|---|---|
| `ies` → `i` when length > 5 | 6 letters | studies (7) → studi, series (6) → seri, pies (4) → pi (falls to `es`) |
| `ing` stripped when length > 4 | 5 letters | coding → cod, bring (5) → br, sing (4) kept |
| `ed` stripped when length > 4 | 5 letters | baked → bak, bred (4) kept |
| `es` stripped when length > 3 | 4 letters | games → gam, toes (4) → to, yes (3) kept |
| final `s` stripped when length > 3, not `ss` | 4 letters | books → book, cats → cat, bus kept, class kept |
| doubled final consonant undoubled when length > 3, not l/s/z | 4 letters | running → run, swimming → swim, jazz, spell kept, egg (3) kept |

## `score(analyze(a), analyze(b))`: kinds of text people type (TS-MAT-n)

| Category | Classes |
|---|---|
| content | nothing meaningful (empty, spaces, only stopwords, only punctuation/emoji) [single]; meaningful words |
| relation of a to b | identical wording (any case/punctuation); same category, different words; different categories, no shared words; one-letter typo |
| script | Latin ASCII; Latin with diacritics (Turkish, French); non-Latin (Japanese, Russian, Arabic, Greek) |
| length | normal; very long (3,000+ characters) [single] |

| Id | Case | Expected |
|---|---|---|
| TS-MAT-1 | tokenizing case, punctuation, apostrophes, stopwords, non-strings | stable tokens |
| TS-MAT-2 [single] | nothing meaningful vs anything, and vs itself | 0 |
| TS-MAT-3 | identical wording | ≥ 0.95 |
| TS-MAT-4 | same category, different words (gym / yoga) | ≥ 0.3 + 0.4 × category overlap |
| TS-MAT-5 | different categories | < 0.15 (match threshold) |
| TS-MAT-6 | typo in a long word | right category, ≥ 0.5 |
| TS-MAT-7 [single] | very long input | still matches its topic |
| TS-MAT-8 | identical non-Latin text | ≥ 0.95 (**D3**: was 0) |
| TS-MAT-9 | diacritics | kept whole; unrelated Turkish phrases < 0.15 (**D3**: was 0.17) |

Properties that must hold for *every* input (fast-check, `test/property/invariants.test.js`): P-MAT-1 range [0,1],
P-MAT-2 symmetry, P-MAT-3 identical ≥ 0.95, P-MAT-4 case/punctuation invariance, P-MAT-5 tokenize idempotent.
Quality on realistic pairs is measured statistically, not asserted: `test/ab/` and `docs/ab-testing.md`.
