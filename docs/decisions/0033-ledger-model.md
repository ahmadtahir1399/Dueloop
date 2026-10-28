# 0033: The money-in ledger: receipts, applied payments, credits (prompt 5, issue B)

**Context.** Prompt 2 had one `payments` table: every row reduced a balance. Money can be more than the
balance, can arrive for a closed invoice, and must never count twice.

**Decision.**
- `receipts` record the money that arrived. Each is unique per `(tenant, method, provider_ref)` (rule 29).
- A receipt splits into an applied slice in `payments`, which still feeds the unchanged `invoice_balances`
  view, and a remainder in `credits`. Invariant: received = applied + credit (rule 28).
- All three tables are append-only, enforced by `private.guard_ledger` for every role. A correction is a
  human task, never an edit.
- `private.apply_payment` is the only writer. It takes the invoice row lock, re-reads status and balance, and
  rejects any plan the numbers do not force (23514): applied = least(amount, balance), 0 on a final invoice;
  credit = the rest; paid if and only if the balance reaches 0. On a stale read it returns `replan`.
- Rows inserted the prompt 2 way get a receipt from a trigger (`source = 'legacy'`), so earlier tests and
  fixtures still balance.
- `private.payment_integrity` and `pnpm payments:integrity` check the invariants. A pgTAP test proves the
  check fails on a corrupted row inside a rolled-back transaction, and a CLI test proves it on a committed one.

**Consequences.** Credits are recorded but never applied to other invoices or refunded: both are out of
scope (DECISIONS NEEDED).
