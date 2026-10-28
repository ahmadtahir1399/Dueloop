# 0034: The payment confirmation pipeline and idempotency (prompt 5)

**Context.** Webhooks, polling, manual bank transfers and confirmed proofs must all confirm money the same
way, exactly once, under concurrency and crashes.

**Decision.**
- Steps: (1) receive (opaque token, raw-body signature, mode check) -> (2) store `payment_events` (unique
  `(provider, provider_event_id)`), queued in the same statement -> (3) resolve through OUR `payment_requests`
  by the provider's object id, never metadata (rule 30) -> (4) plan with pure `planPaymentOutcome` -> (5)
  `apply_payment` in one locked transaction, re-planning up to 10 times when the balance moved -> (6) alerts
  after commit -> (7) mark processed, ack last.
- Manual and proof confirmations enter at step 4 with `confirmed_by` (owner or accountant, re-checked in SQL).
  Polled events enter at step 2 with a `poll:` event id. The receipt key makes a webhook plus a poll for the
  same money count once.
- Unknown request -> urgent `unmatched_payment`. Amount, currency or mode mismatch -> `payment_amount_mismatch`,
  nothing applied. Errors retry with backoff, then dead-letter to an urgent `unprocessed_payment_event` task.
- Proven by the chaos suite: crash at every step, 50 parallel deliveries of one event, N parallel partials,
  and SIGKILL of the processor mid-batch of 200 events (integrity clean, nothing lost, doubled or stuck).
