# 0035: Refunds, chargebacks and failures after success are tasks (prompt 5, issue E)

**Context.** Reopening a paid invoice needs a state-machine change (paid is final), which prompt 5 forbids.

**Decision.**
- `payment_reversed` (refund or chargeback), and a `payment_failed` for money we already confirmed, each
  create an urgent `payment_reversal` task, a `PaymentReversed` invoice event and a critical alert.
  Status, balance and ledger stay as they are.
- A `payment_failed` before any confirmation is only an event (`PaymentFailed`). The request stays active,
  so the customer can try again.
- `payment_processing` (async methods) is never paid. Only a definitive success applies money.

**Consequences.** After a refund the ledger still shows the money as received. A human decides whether to
chase the invoice again. Doing this automatically needs a state-machine change (DECISIONS NEEDED).
