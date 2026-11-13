# Boundary-value analysis: registration and profile (FR1, SR1)

| Id | Field | Valid range | Test values (below / on / above) | Notes |
|---|---|---|---|---|
| BV-AUTH-1 | first/last name | 1–50 characters, letters of any script plus `' . -` and space, starting with a letter | '' / 'A', 50 / 51 | 'Çağla', 'Zoë', '李' valid; '-Anne', 'R2D2' invalid |
| BV-AUTH-2 | password | 8–128, ≥ 1 letter, ≥ 1 digit | 7 / 8, 128 / 129 | letters-only, digits-only, non-strings refused |
| BV-AUTH-3 | email | `x@y.zz` pattern, ≤ 254 | `a@b.c` (1-letter TLD) / `a@b.co`; 254 / 255 | lowercased and trimmed |
| BV-AUTH-4 | date of birth | age 18–120 on the day | 18th birthday tomorrow / today; 120 / 121; a future date | 29 Feb birthdays: 18 on 1 March in non-leap years |
| — | date format | real `YYYY-MM-DD` dates | 1995-02-29, 2001-02-31, 1995-13-01, 1995-6-15 refused; 1996-02-29 accepted | |
| BV-AUTH-5 | avatar | png/jpeg/webp/gif data URL ≤ 300 KB (307,200 chars) | 307,200 / 307,201 | svg, html, remote URLs refused |
| BV-AUTH-6 | bio / interests / languages | ≤ 200 / ≤ 5 / ≤ 5 | 200 / 201; 5 / 6; 5 / 6 | interests deduplicated case-insensitively, `#` stripped, cut at 24 |

The age oracle in the property test P-AUTH-1 is independent of the implementation: it adds 18 years with
`Date.UTC` and compares with today, instead of re-using `ageOn`.
