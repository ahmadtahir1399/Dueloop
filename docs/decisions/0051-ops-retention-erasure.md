# 0051: Schema guard, heartbeats, retention, erasure and suppression (prompt 7 steps 2-3)

**Schema-version guard (migration 0021).** `private.schema_version()` reads the newest applied version from
`supabase_migrations.schema_migrations`. Every long-running entry point (worker, inbound processor, webhooks, and
the web server in production via `instrumentation-node.ts`) calls `assertSchema` at start and refuses to run when the
database is not at `EXPECTED_SCHEMA_VERSION` (`packages/ops`). The message names both versions and what to do; it
never contains a connection string. A unit test fails if the constant is not the newest migration file, so a new
migration and the constant change in the same commit.

**Heartbeats and watchdog.** Services upsert `private.service_heartbeats` (service, instance, version, ok, counts-only
details) once per pass. `private.ops_status(now)` returns queue depth and age, due-but-not-queued invoices, parked,
unknown messages, dead letters, approvals, unprocessed inbound/payment events, pauses and heartbeat ages.
`evaluate()` (pure) turns that into findings with counts only; `pnpm ops:watchdog` alerts once per finding per hour
(`private.ops_alerts`) and exits 1 when anything is critical, so a scheduler can page on the exit code. `/health` is
liveness only (no database); `/ready` checks the database and the schema version and answers with names, not values.
All of this is service-only: no API role can read these objects (tested).

**Retention** (`pnpm retention:run`, `private.retention_run`). Inbound and payment events past their `purge_after`
(existing functions), raw import rows after 90 days, closed or expired public links after 30 days, rate-limit windows
after 2 days, expired API idempotency records, and proof FILES 400 days after the invoice closed (the proof row stays,
marked purged). Ledger rows, invoices, messages metadata and append-only events are kept: they are the business record.
One `RetentionRun` tenant event per tenant holds numbers only. These periods are engineering defaults, not legal
advice; an operator must set them for their jurisdiction (TODO for the operator, recorded in the report).

**Erasure** (`pnpm customer erase --tenant <id> --customer <id> --yes`). Refused while the customer has an open
invoice (balance or dispute still in play) and for any id not in that tenant. Otherwise: the customer row is
anonymised (`Erased customer <8 hex>`, contact fields null, opted out), message bodies and subjects are nulled, proof
files are removed from storage, inbound raw payloads are purged, and a `CustomerErased` event records counts only.
Receipts, payments and credits are kept, so `received = applied + credit` still holds and the integrity check passes
after erasure (tested). Events and ledger notes never held contact details (tested by a pattern scan), which is the
precondition for keeping them. Proof files are deleted from storage AFTER the database transaction commits; if that
call fails the command exits non-zero and must be re-run (the files are found again by customer id). DECISION NEEDED
(operator): whether erasure should also be possible while invoices are open; today it is refused.

**Export** (`pnpm customer export`): everything held about one customer as JSON on stdout; a `CustomerExported` event
records counts only.

**Suppression list.** Opting out (any path) and erasure store a salted sha256 of the normalised email/phone in
`private.suppressions`; the salt is per tenant and never leaves the database. A trigger on `customers` sets
`opted_out = true` whenever an inserted or updated row matches, so an import, the API or a hand edit cannot quietly
re-add an erased or opted-out person and message them. Consequence: re-subscribing someone who opted out needs an
operator to delete the suppression row on the trusted connection; there is no UI or CLI for that yet (gap, reported).
