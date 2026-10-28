# 0024: Inbound pipeline and exactly-once effects

**Context.** Providers retry and deliver out of order, processes die, and a reply's effects (a promise, a
dispute, an opt-out) must happen exactly once and only as planned by code.

**Decision.** `packages/inbound/src/pipeline.ts` implements the prompt's ten steps:

1. **Receive.** The webhook or IMAP poller verifies, then calls `private.store_inbound_event`. That function
   resolves the tenant from the channel account, dedupes on (tenant, provider, provider event id), sets
   `purge_after` and queues the event, all in one statement.
2. **Claim** from pgmq `inbound_events` with a visibility timeout. Failures retry with backoff; after N
   attempts the event goes to `dead_letters`, a task `unprocessed_inbound` and `InboundDeadLettered`.
3. **Normalise.** postal-mime with hard limits, a size cap before parsing, html-to-text, a quoted-history
   heuristic and attachment metadata. WhatsApp items follow Meta's documented shapes.
4. **Sender.** The sender is resolved within the tenant using ingest's email/E.164 normalisers. A contact
   shared by two customers counts as unknown.
5. **Store** the message once per (tenant, channel, provider message id). If it was already processed,
   processing stops.
6. **Pre-filters**, then **match** (ADR 0025).
7. **Classify** (ADR 0029).
8. **Plan.** core `planReplyOutcome`, which is pure.
9. **Apply** in one transaction (`InboundDb.applyPlan`):
   - the message row is locked and `processed_at` is the exactly-once guard;
   - an optimistic guard re-checks the invoice status, and a mismatch means re-plan (bounded);
   - every write carries an idempotency key.
10. Mark the event processed, then **ack last**. Alerts go out after commit, best effort and
    de-duplicated.

**Consequences.**
- A crash at any step, re-delivery, duplicate delivery or reordering never repeats an effect (chaos suite:
  kill points plus a SIGKILL of a 200-event batch).
- An alert can be lost if the process dies between the apply commit and the notify call. The task and the
  events are the durable record.
- Deviation: the prompt says "RPC". Apply runs as one SQL transaction from the processor's direct trusted
  connection (like the worker), not as a PostgREST RPC.
