# 0052: Stale queue jobs are dropped before decide() (bug found in prompt 7 verification)

**Bug.** A job on `followup_actions` was processed without checking that the invoice was still queued. A worker
killed after `recordSent` (which reschedules the invoice to the next day) but before `ack` left the job to reappear
after its visibility timeout. The next pass ran `decide()` with fresh context, saw step 1 sent and step 2 already due
(an invoice far past due), and sent step 2 seconds after step 1. Each idempotency key was still used once, so the
per-key invariant held, but the customer got two reminders back to back. Worse, after an `unknown` message the sweep
parks the invoice for a human (rule 17), and a redelivered job still sent the next step.

Found by the SIGKILL chaos test (about 1 run in 5: 101 sends for 100 invoices) and made deterministic by tightening
the failpoint cases to count every adapter call, not only the first step's key. Three of the four cases failed before
the fix.

**Fix.** `processJob` first asks `WorkerDb.jobIsCurrent`: the invoice must still have `enqueued_at` set and
`next_action_at <= now`. Every reschedule (send recorded, park, wait, approval requested, unknown) already clears
`enqueued_at`, and only `private.enqueue_due_actions` puts jobs on the queue (it sets `enqueued_at` in the same
transaction). A stale job is acked and counted as `skipped`; nothing is sent. The same check drops the duplicate job
the 15-minute re-enqueue can create once the first one has been handled.

**Verified.** The four failpoint cases, the SIGKILL test six times in a row, the full DB suite, the load test, and the
send/replies/payments demos.
