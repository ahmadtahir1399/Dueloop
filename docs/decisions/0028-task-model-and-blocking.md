# 0028: Human tasks and reminder blocking

**Decision.**
- **Task types**: review_promise, verify_payment_claim, dispute, info_request, human_review,
  ambiguous_invoice, unmatched_inbound, unprocessed_inbound, delivery_failed, invalid_contact.
  - `reason` is a typed code (core `ReviewReason` or a provider code such as `dsn_5_1_1`).
  - `details` holds ids and numbers only.
  - `draft_reply` is a code-written DRAFT for a human to edit and send themselves. Nothing is ever sent
    from a task (rule 22).
- **Exactly once**: `dedupe_key = <message id>:<task type>`, unique per tenant.
- **Who**: tasks are read by every member. They are worked through `resolve_task` / `reopen_task`, which
  require a note and record who resolved them (ADR 0022). CLI: `pnpm tasks list|show|resolve|reopen`.
- **Blocking**: `tasks.blocks_reminders_until`. "Already paid" (3 days, `paymentClaimBlockDays`) and info
  requests (3 days) block only for a trusted sender (ADR 0026). The worker has two gates:
  - **pre-decide**: an open, unexpired block sets `next_action_at` to its end and sends nothing;
  - **final** (just before the adapter): a block, an opt-out or a pause that arrived after `decide()` gives
    the outbox claim back (`pending` → `retry`, attempt restored). This is provably not sent, because the
    adapter was not called (issue L).

  When a block expires and its task is still open, the owner is alerted once (RemindersResumed) and
  reminders resume. Resolving a blocking task re-enters `decide()` at once.
- **`approval_mode = 'low_confidence'`** (issue N): approval is required when the invoice has an open
  `human_review` task, or the customer has an open low-confidence/invalid-output reply task from the last
  14 days. Otherwise reminders go out without approval.

**Decisions needed.** Block lengths (3 days each). The `low_confidence` definition above.
