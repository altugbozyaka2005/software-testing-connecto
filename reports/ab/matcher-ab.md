# Offline A/B: word matching (A) vs word + meaning (B), 2026-11-13

96 labelled pairs (53 should match), match threshold 0.15. 95% Wilson intervals in brackets.

| Metric | A: words only | B: words + meaning |
|---|---|---|
| accuracy | 0.573 [0.473, 0.667] | 0.74 [0.644, 0.817] |
| precision | 0.607 [0.476, 0.724] | 0.689 [0.577, 0.783] |
| recall | 0.642 [0.507, 0.757] | 0.962 [0.872, 0.99] |
| specificity | 0.488 [0.346, 0.632] | 0.465 [0.325, 0.611] |
| errors (FP / FN) | 22 / 19 | 23 / 2 |

Exact McNemar test on the 18 pairs where they disagree: only A right 1, only B right 17, p = 0.000145.

Exploratory candidate C (no category floor, best threshold 0.5, tuned on the same pairs so optimistic): accuracy 0.823 [0.735, 0.886], precision 0.8 [0.682, 0.882], recall 0.906 [0.797, 0.959], specificity 0.721 [0.573, 0.833]. McNemar B vs C: only B right 3, only C right 11, p = 0.0574.

| Kind of pair | pairs | expected | A correct | B correct | C correct |
|---|---|---|---|---|---|
| same words | 8 | match | 8 | 8 | 8 |
| paraphrase | 20 | match | 17 | 20 | 19 |
| slang | 5 | match | 2 | 3 | 1 |
| typo | 6 | match | 6 | 6 | 6 |
| cross-lingual | 14 | match | 1 | 14 | 14 |
| shared word | 15 | no match | 1 | 1 | 8 |
| same area | 8 | no match | 0 | 0 | 3 |
| unrelated | 20 | no match | 20 | 19 | 20 |

| Threshold | accuracy A | accuracy B | accuracy C |
|---|---|---|---|
| 0.1 | 0.573 | 0.74 | 0.74 |
| 0.15 | 0.573 | 0.74 | 0.74 |
| 0.2 | 0.573 | 0.74 | 0.74 |
| 0.3 | 0.604 | 0.75 | 0.75 |
| 0.4 | 0.604 | 0.74 | 0.75 |
| 0.5 | 0.615 | 0.771 | 0.823 |

Online follow-up: to detect a lift in request acceptance from 30% to 35% (α = 0.05, power 0.8) needs 1377 requests per arm.

## Pairs B gets wrong

| kind | a | b | expected | B score |
|---|---|---|---|---|
| slang | grinding ranked in val | playing valorant competitive | match | 0.082 |
| slang | doomscrolling | scrolling social media | match | 0.04 |
| shared word | playing chess | playing football | no match | 0.7 |
| shared word | reading a novel | reading my emails | no match | 0.5 |
| shared word | learning spanish | learning to drive | no match | 0.5 |
| shared word | watching football | playing football | no match | 1 |
| shared word | cooking dinner | eating dinner with family | no match | 0.7 |
| shared word | writing code | writing a poem | no match | 0.433 |
| shared word | studying chemistry | studying law | no match | 0.7 |
| shared word | playing piano | playing valorant | no match | 0.5 |
| shared word | running a marathon | running a business | no match | 0.5 |
| shared word | training my dog | training for a marathon | no match | 0.7 |
| shared word | drawing anime | watching anime | no match | 0.781 |
| shared word | building a website | building lego | no match | 0.414 |
| shared word | making music | making bread | no match | 0.228 |
| shared word | listening to a podcast | listening to my lecture recording | no match | 0.925 |
| same area | studying calculus | studying history | no match | 0.7 |
| same area | playing guitar | playing drums | no match | 0.7 |
| same area | going to the gym | swimming laps | no match | 0.7 |
| same area | watching a horror movie | watching youtube tutorials | no match | 0.7 |
| same area | learning french | learning korean | no match | 0.7 |
| same area | baking a cake | grilling burgers | no match | 0.7 |
| same area | playing minecraft | playing chess | no match | 0.7 |
| same area | knitting a scarf | painting a portrait | no match | 0.7 |
| unrelated | ders çalışıyorum | film izliyorum | no match | 0.446 |
