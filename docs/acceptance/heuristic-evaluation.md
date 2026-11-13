# Heuristic evaluation (expert inspection of the UI)

Y&P ch. 22.4: "inspection applies usability check-lists to specification and design". One evaluator (me),
Nielsen's 10 heuristics, on the screenshots taken by `test/acceptance/usability.spec.js`
(`reports/usability/screens/*-{desktop,mobile}-chromium.png`, 13 Nov 2026) and on using the app. Severity uses
Nielsen's scale: 0 not a problem … 4 usability catastrophe. A single evaluator typically finds about a third of
the problems (Nielsen & Landauer), so this complements, not replaces, the study with users.

| # | Screen (screenshot) | Heuristic | Sev | Observation | Recommendation |
|---|---|---|---|---|---|
| H1 | call, phone (07-call-mobile) | 1 Visibility of system status; 8 Minimalist design | 3 | Toasts from earlier screens ("Email confirmed ✔", "Request sent to Uma S. — We'll let you know when they respond") stay on top of the call on a phone and cover the bottom of the video, where the mic/camera/leave controls are. The second toast is also *wrong* once the call has started. | Dismiss request toasts when the room starts; place toasts above the controls on phones. Add to the usability study (T2/T3). |
| H2 | matches (05-matches) | 2 Match with the real world; 10 Help | 2 | "70%" with a bar is not explained: 70% of what? People may read it as compatibility of the *person* rather than of the activity wording. | Tooltip/label "70% similar activity". |
| H3 | create account (02-create-account) | 5 Error prevention | 2 | The form is long (photo, 2 names, email, password, date, gender, checkbox); on a phone the Create button is below the fold. Field rules are shown only for the password. | Show the 18+ rule next to the date field; keep the photo step for after sign-up. |
| H4 | check inbox (03-check-inbox) | 3 User control and freedom | 1 | Good: resend, sign out/start over and spam hint are offered; the page continues by itself once confirmed. | — |
| H5 | incoming panel (06-incoming-request) | 1 Visibility; 6 Recognition rather than recall | 2 | On desktop the requester's own card also changes to "Wants to join you — accept" in the grid while the panel opens: two places to accept the same request. The panel's tab ("Incoming") is a narrow vertical label at the screen edge, easy to miss when the panel is closed. | Keep one primary place; make the closed tab show the count prominently (it does have a badge). |
| H6 | report dialog (08-report-dialog) | 5 Error prevention; 3 User control | 1 | Good: confidential wording, "Also block" pre-ticked, Cancel available. After D9 the dialog fits a phone. | — |
| H7 | after report (09-after-report) | 1 Visibility | 1 | The call ends and the user is back on matches; a confirmation toast says the report was sent. | — |
| H8 | sign in (01-sign-in) | 4 Consistency and standards | 1 | "Sign in" / "Create account" tabs plus a "Create an account" link at the bottom do the same thing; harmless. | — |
| H9 | all screens | Accessibility | 3 → 0 | Low-contrast coral buttons/links and avatar initials (D8) | Fixed (axe: 0 violations). |
| H10 | call, phone | 7 Flexibility; layout | 3 → 0 | The call header made the page 524 px wide on a 412 px phone (D9). | Fixed. |

Problems H1–H3 and H5 are the questions the usability study should confirm or refute with real users
(tasks T2/T3 for H1, T1 for H2/H3, T2 for H5).
