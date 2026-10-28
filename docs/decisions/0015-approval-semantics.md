# 0015: Approval semantics

**Decision.**
- An approval authorises exactly one idempotency key. It never sends and never bypasses `decide()`.
  Approving sets `next_action_at = now`, and the worker re-runs `decide()` and every gate with fresh
  context before the send (rule 16).
- There is one approval row per (tenant, key). A rejection records the step as a `skipped` message, so
  `decide()` never proposes it again (issue E).
- Approving after the invoice was paid, written off, cancelled or disputed returns `superseded` and sends
  nothing. If `decide()` no longer proposes an approved key (the customer opted out, the invoice was paid),
  the approval is superseded.
- Pending approvals expire after 7 days (`approvalMaxAgeDays`). The invoice re-enters `decide()`; a new
  request reopens the same row with `version + 1`, and its event keys carry the version.
- `approval_mode = low_confidence` behaves exactly like `always` until Prompt 4 provides a confidence
  signal. **Decision needed** from the product owner.
- Edits (`edit_approval`) change subject and body. The opt-out footer is appended after the edit at send
  time, so an edit cannot remove it.
