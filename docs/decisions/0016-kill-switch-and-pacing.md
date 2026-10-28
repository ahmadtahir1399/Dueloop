# 0016: Kill switch and pacing

**Decision.**
- There are two switches, both checked at the send gate of every job (rule 18):
  - global: `private.system_flags.outbound_paused`, set with `pnpm tenant pause --global`;
  - tenant: `tenants.outbound_paused`, set with `public.set_outbound_paused` (owner) or the CLI.

  A paused tenant is not enqueued, and a job already queued is released, not dropped. Flipping either
  switch mid-batch stops the very next job (chaos test).
- The weekly cap (`max_messages_per_week`) is per **customer**, across all their invoices (issue C).
  Pending and unknown messages count as sent for the cap.
- Rule D: after any send, the invoice's next action is the start of the next local day's send window plus
  deterministic jitter (FNV-1a of the invoice id, 0..`jitterMinutes`). An invoice gets at most one reminder
  per local day, and a late import cannot fire a backlog in one burst. **Decision needed:** whether
  one-per-day should be per customer rather than per invoice.
- Rate limiter: an in-process token bucket per tenant + channel (default burst 5, refill 1/s). Limited
  jobs are released with a short delay. With several worker processes the limit applies per process; a
  shared limiter is future work.

**Known window.** The kill switch is read just before the outbox claim. Rendering and the claim take
milliseconds, but a pause that lands in that window cannot stop that one send.
