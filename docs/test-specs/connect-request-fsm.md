# Model-based testing: the connect-request state machine (FR5)

`background.js` keeps one live request per pair of people. Model (time windows from the code's constants):

```
                 request(a,b)                  respond(b, yes) / request(b,a)
   NONE ───────────────────────▶ PENDING(a→b) ─────────────────────────────▶ ACCEPTED ──settle──▶ DONE (history, 7 days)
    ▲  ▲                           │   │   │                                   │   │
    │  └──────── cancel(a) ────────┘   │   └── 7 days ──▶ (expired)             │   └── 48 h, or 2 h after a scheduled
    │                                  │                                        │       meeting ──▶ (expired)
    │                 respond(b, no) ──┴──▶ DECLINED (hidden; a may ask again)  │
    └────────────────────────── forget (block): erases every state and history ┘
```

Guards (invalid transitions, I1–I5): request to yourself; the sender answering their own request; a third person
answering; the recipient cancelling; cancelling or declining after acceptance.
Counting rule (SR3): every request created counts toward the sender's 20 per 24 h, **including cancelled ones** (D5).

## Adequacy criteria used

- **Transition coverage:** every arrow above exercised at least once (T1–T12 in `test/unit/background.fsm.test.js`),
  with the time-based arrows tested exactly at their boundaries using a controllable clock (7 days − 1 ms / 7 days,
  48 h − 1 ms / 48 h, meeting + 2 h − 1 ms / + 2 h).
- **Invalid transitions:** I1–I5 each once, checking state is unchanged.
- **Random walks:** 200 sequences of up to 40 commands (request/respond/cancel/settle among 4 people) checked step by
  step against an executable model (`model()` in the same file), comparing every pair's state after every command.
  This covers transition *sequences* (e.g. decline then re-request then mutual request) that transition coverage does not.
- Scheduling boundaries (BV-SLOT): proposed times must be > now + 5 min and < now + 30 days; at most 3 after removing
  duplicates and junk; only the other person can pick; only a proposed, future time.
