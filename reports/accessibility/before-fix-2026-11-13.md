# axe-core WCAG 2.1 A/AA audit — before the D8 fix (13 Nov 2026)

`npx playwright test test/acceptance/accessibility.spec.js`, desktop Chromium, light theme.
All violations were rated **serious** by axe; none critical. After the fix (commit "fix: D8 …")
every screen reports 0 violations (`reports/accessibility/screens/*.json`).

| Screen | axe rules passed | Violations (rule × elements) | Elements |
|---|---|---|---|
| Sign in | 25 | color-contrast × 4 | `.tagline > em`, "Forgot password?" link, Sign in button, "Create an account" link |
| Create account | 28 | color-contrast × 3 | `.tagline > em`, Create account button, "Sign in" link |
| Check your inbox | 19 | color-contrast × 2 | Resend email button, "Sign out and start over" link |
| Activity prompt | 24 | color-contrast × 1; label-content-name-mismatch × 1 | Find people button; account pill (`aria-label="Account menu"` hides the visible name) |
| Matches | 25 | color-contrast × 1; label-content-name-mismatch × 1 | generated avatar initials; account pill |
| Incoming requests panel | 24 | color-contrast × 2; label-content-name-mismatch × 1 | avatar initials, "Accept · join call" button; account pill |
| Call | 22 | color-contrast × 3 | large avatar initials, Leave label, chat Send button |
| Report dialog | 18 | color-contrast × 1 | Send report button |

Measured contrast of the original colours with white text: accent `#ff6b4a` 2.82:1, good `#1fa971` 3.01:1,
danger `#e5484d` 3.91:1, generated avatars `hsl(h 65% 55%)` as low as 1.53:1 (yellow hues). WCAG 1.4.3 needs 4.5:1.

Fix: text/button-fill tokens `--accent-strong #c94420` (4.85:1), `--good-strong #13774f` (5.56:1), `--danger #d03238`
(5.01:1); avatars `hsl(h 50% 32%)` (≥ 4.52:1 for every hue); account pill's accessible name now starts with the
visible name ("Mo, account menu", WCAG 2.5.3). Decorative uses of the brighter coral (logo, shadows, score bars) are unchanged.
