# 0039: Receipts as a transactional send in the prompt 3 outbox (prompt 5, issue K)

**Context.** A receipt is not a reminder: nothing is left to decide. It is still an outbound message to a
customer, though.

**Decision.**
- `apply_payment` queues `{kind: 'receipt', receipt_id}` on `transactional_sends` in the ledger transaction.
  A confirmed receipt therefore always has exactly one job, and a crash after the commit cannot lose it.
- The receipt worker skips `decide()` and approvals. It keeps everything else from rule 32: the
  `receipt:<id>` idempotency key in `messages` (`purpose = 'receipt'`), the kill switch at claim time and
  again right before the adapter (held, resumed later), opt-out (a `ReceiptSkipped` event), consent and
  route, budget, rate limit, and at-most-once.
- A stale pending receipt becomes `unknown` and is never resent (rule 17). Unlike a reminder, it does not
  park the invoice (migration 0014). A human reconciles it, and "not sent" re-queues the same key.
- Receipts do not count toward the weekly reminder cap. They do count toward the budget.
- Templates are `receipt` for email (built-in default) and WhatsApp (needs an approved template): plain text
  with the amount received, the invoice number and the remaining balance.
- Issue L: a paid or balance check runs before the claim and again right before the adapter. Money that
  lands mid-job stops the reminder (`gate_paid`), and a changed balance re-renders the new amount.
