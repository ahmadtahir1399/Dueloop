# 0013: Send protocol: outbox, at most once, unknown is never resent

**Context.** A reminder must never reach a customer twice, and a crash can happen between any two
steps. None of our providers offers an idempotency key (SMTP has none; the WhatsApp Cloud API has none).

**Decision.** Every send follows these steps (`packages/worker/src/process.ts`):

1. Claim a job (pgmq, visibility timeout).
2. Load fresh context; run `decide()` (core, unchanged).
3. Gates: kill switch (tenant + global) → opt-out → router (contact, consent, budget, template, account) →
   rate limiter.
4. Approval for exactly this idempotency key (`<invoice>:<step>:<channel>`).
5. Render (pure; before the claim, so a template error never leaves a pending row).
6. Claim the key in the outbox: `messages` row `send_state = pending` + `message_invoices`, unique per
   (tenant, key).
7. Adapter call under a hard timeout.
8. Record the outcome in one transaction (message state, event, `next_action_at`).
9. Ack the job.

Outcomes: sent, not_sent_retryable, permanent, ambiguous. Ambiguous (a timeout, a connection lost
mid-request, a 2xx without an id) leaves the row `pending` and parks the invoice. The stale sweep (15 min)
turns old `pending` rows into `unknown`, appends `MessageStateUnknown`, parks the invoice
(`message_unknown`) and alerts once. A human resolves it with
`pnpm messages resolve <id> --as sent|not_sent`.

If a job finds its key already in the outbox:

- `sent` → bookkeeping only (`already_sent`);
- `pending` and young → `busy`, released;
- `pending` and old → `unknown`;
- `unknown` → stays parked;
- `retry` → reclaimed with the same key, attempt + 1.

**Consequences.** At most once, not exactly once: a crash after the provider accepted the message but
before step 8 leaves an unknown message for a human. The chaos suite (`pnpm chaos`) crashes at every step
and SIGKILLs a real worker process mid-batch: at most one adapter call per key in every case.

Parking uses `next_action_at = 'infinity'` + `invoices.parked_reason` rather than NULL, because Prompt 2
made `next_action_at` NOT NULL (issue H test).
