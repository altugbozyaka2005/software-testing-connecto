# Acceptance testing with users: usability study protocol (QA-U1, US-1..4)

**Status: designed and ready to run; not yet run with participants** (no time to recruit before the deadline,
see "What has been done instead" below). Everything needed is in this folder: tasks, script, questionnaire,
data template (`usability-data-template.csv`) and the analysis tool (`test/acceptance/analyse-usability.js`,
itself unit tested in `test/unit/usability-analysis.test.js`).

## Why users are needed

The automated tests *verify* usability criteria (Y&P ch. 22.4: click counts, keystroke-level predictions,
WCAG rules). Whether the product is quickly learned, efficient and pleasant can only be *validated* with
real users: the automated KLM time is an expert, error-free lower bound; it cannot tell whether people
understand "Send request · they'll see it later", find the incoming-requests panel, or trust the report flow.

## Participants (Y&P: 3–5 users per group, 1–4 groups)

| Group | Why | n | Screener (questionnaire) |
|---|---|---|---|
| G1 students 18–25 | primary users | 5 | age, studies, uses video calls weekly |
| G2 non-native English speakers (Turkish first language) | the app's main market; matching in other languages (D3, A/B) | 4 | first language |
| G3 adults 35+ less used to social apps | learnability | 3 | age, apps used |
| G4 one screen-reader or keyboard-only user | QA-ACC1 beyond what axe can check | 1–2 | assistive technology used |

Recruitment: classmates and family (G1–G3); the University's disability service for G4. Over 18 only (the app is 18+).

## Tasks (each with success criterion and time limit)

| Task | Scenario given to the participant | Success | Limit |
|---|---|---|---|
| T1 | "Make an account and find someone doing what you are doing now." (moderator confirms the email for them) | sees the match list with ≥ 1 card | 4 min |
| T2 | "Ask the person studying the same thing as you to talk, and start the call when they accept." | in the call | 2 min |
| T3 | "The person you're talking to is being rude. Make sure they can't contact you again." | report sent with block ticked | 2 min |
| T4 | "Only show you people who speak Turkish." | language filter saved | 2 min |
| T5 | "Keep searching for chess partners after you close the tab, for the next 12 hours." | background search started, 12 h | 2 min |

The moderator plays the "other person" on a second device.

## Procedure (60 minutes or less)

1. Consent form (anonymous data, can stop at any time, no recording of faces; screen + audio recording only with consent), screener.
2. Think-aloud practice (1 min).
3. Tasks T1–T5 in this order, on the participant's own phone if they have one (half the participants), otherwise a laptop.
   **Do not help** (the hardest part, Y&P): if stuck for 60 s, give the standard hint "where would you expect to find it?";
   a second hint counts as an *assist*. After each task: Single Ease Question (1–7).
4. System Usability Scale (10 items, below).
5. Debrief: "What was the most confusing moment?", "Would you use this?".

## Measures and acceptance criteria

| Measure | How | Accept if (QA-U1) |
|---|---|---|
| Task completion | success without assist | ≥ 80% per task (Adjusted Wald 95% interval reported) |
| Time on task | stopwatch from scenario read to success | median ≤ 3× the KLM prediction (`reports/usability/task-metrics-*.json`) |
| Errors | wrong screen, wrong button, unexpected state | recorded, classified against the heuristics below |
| SEQ | 1–7 after each task | mean ≥ 5.5 |
| SUS | 0–100 | mean ≥ 68 (industry average), 95% CI reported |

## System Usability Scale (Brooke 1996), 1 = strongly disagree … 5 = strongly agree

1. I think that I would like to use Connecto frequently.
2. I found Connecto unnecessarily complex.
3. I thought Connecto was easy to use.
4. I think that I would need the support of a technical person to be able to use Connecto.
5. I found the various functions in Connecto were well integrated.
6. I thought there was too much inconsistency in Connecto.
7. I would imagine that most people would learn to use Connecto very quickly.
8. I found Connecto very cumbersome to use.
9. I felt very confident using Connecto.
10. I needed to learn a lot of things before I could get going with Connecto.

## Comparison (A/B) usability test, if time allows

Y&P's "comparison testing": the incoming request either **(A)** opens the side panel automatically (current) or
**(B)** shows a toast with Accept/Decline (the behaviour on other screens). Within-subjects, order counterbalanced,
measure time-to-accept and errors. With 12 participants the study can only detect large differences; the online A/B
design for the matcher is in [../ab-testing.md](../ab-testing.md).

## What has been done instead (so far)

- Automated verification of the measurable part: `test/acceptance/usability.spec.js` (click counts, KLM, desktop and phone).
- Accessibility audit with axe (D8 fixed) and a keyboard walk-through (A11Y-3).
- An expert **heuristic evaluation** of the screenshots: [heuristic-evaluation.md](heuristic-evaluation.md).
- Executable acceptance criteria for the user stories: `test/acceptance/stories.spec.js`.

## Analysis

`node test/acceptance/analyse-usability.js docs/acceptance/usability-data.csv` computes completion rates with Adjusted
Wald intervals, median and geometric-mean task times, SEQ means and SUS with a 95% t-interval, per task and per group.
