# 0006: The balance is derived, never stored

**Context.** Invariant 3.4: "Balance = total minus sum of confirmed payments, never stored twice and
drifting." The guide's draft still had `invoices.amount_paid`, a second copy that a missed update or a
replayed webhook could make wrong (issue A, test `issue_a_balance`).

**Decision.**
- No `amount_paid` column. `public.invoice_balances` (a `security_invoker` view, so callers only see rows
  their RLS allows) computes `amount_paid = sum(payments.amount)` and `balance = amount_total - amount_paid`.
- `payments` is the single source. `unique (tenant_id, method, provider_ref)` means a payment can never
  count twice.
- The invoice total may never drop below what is already confirmed (trigger `invoices_guard`). Imports
  that would do so are skipped with a `total_below_paid` warning.
- Overpayment is allowed and shows as a negative balance (a credit). Whether to refund or apply it is a
  later product decision.

**Consequences.** Every balance read is an aggregate over that invoice's payments, which are indexed by
`(tenant_id, invoice_id)`. At expected volumes (tens of payments per invoice) this is cheap. If a dashboard
ever needs balances across many thousands of invoices at once, add a materialised view or a
trigger-maintained cache after measuring, and get a decision before storing a second copy.
