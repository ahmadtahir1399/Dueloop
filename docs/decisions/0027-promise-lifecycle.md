# 0027: Promise lifecycle (issues D, E, G)

**States.** `active` → `kept` | `broken` | `superseded` | `cancelled`. The partial unique index
`promises_one_active` allows at most one active promise per invoice. Every promise has a source message,
a `reference_at` (when the customer wrote it, issue K) and `promised_on` (validated by
`validatePromiseDate`).

**Transitions.**
- **Created** by the processor when `planReplyOutcome` returns `set_promise`. That needs a trusted sender,
  an `overdue` invoice, a concrete in-range date, no partial or unparseable amount, confidence above the
  threshold, fewer than `maxRenewals` (2) earlier promises that did not hold, and
  `tenants.promise_acceptance = 'auto'`. The invoice moves to `promised` and `invoices.promised_on` is set.
- **Broken** by the worker: when `decide()` returns `mark_promise_broken` (promised_on + grace passed), the
  worker applies `promise_broken` and sets the active promise to `broken`.
- **Superseded** only by a promise from a NEWER message (by `reference_at`). A late-processed OLDER message
  never supersedes. In practice a second promise arrives while the invoice is `promised`, and the state
  table allows promises only from `overdue`, so it becomes a `review_promise` task. Renewals while
  promised are a human decision.
- **Cancelled** by an owner or accountant via `public.cancel_promise` (event PromiseCancelled). The invoice
  re-enters `decide()`.
- **Kept** is prompt 5: when a payment confirms the balance, prompt 5 must set the active promise to `kept`.

**Decisions needed.**
- `promise_acceptance` defaults to `auto`. Should it be `review`?
- Promises on `open` (not yet due) invoices currently go to a human, because the state table has
  `promise_accepted` only from `overdue`.
- Renewal while `promised` is a human decision.
- A stated amount must equal the balance; partial-amount promises go to a human.
