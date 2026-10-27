# CLAUDE.md

1. Core is pure: no I/O, no clock, no randomness. `now` is an argument.
2. Dependencies point inward. core imports nothing from the repo.
3. Money is an integer in minor units + currency code. Never float. Never assume 2 decimals.
4. Time zones are IANA names, never fixed offsets.
5. The AI proposes, code decides. Only the state machine changes invoice status.
6. "Already paid" never closes an invoice. Only confirmed payment.
7. Every outbound action has a stable idempotency key.
8. Never invent library APIs or provider details; check docs.
9. Never claim a command passed unless you ran it this session.
10. Bug fixes: write the failing test first, then the fix.
