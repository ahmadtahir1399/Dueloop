# 0009: invoice_events is immutable; tenant removal is the only way events disappear

**Context.** Invariant 3.4: "Everything is an event. Current state can always be explained by the list of
events." The draft made `invoice_events` append-only by comment, and its `on delete cascade` from invoices
meant that deleting an invoice silently erased its history (issue E, test `issue_e_events_append_only`).

**Decision.**
- Trigger `invoice_events_no_update_delete` rejects every UPDATE and every DELETE (SQLSTATE 23514), for
  every role including `postgres` and `service_role`. A statement trigger rejects TRUNCATE.
- No client role holds UPDATE or DELETE on the table. The service role may only INSERT and SELECT.
- `(tenant_id, idempotency_key)` is unique, so one logical event (for example `ReminderSent` for
  `invoice:step:channel`) is written at most once.
- The FK from events to invoices has no cascade, so an invoice with history cannot be deleted (void it).
- **Tenant removal** (offboarding, a privacy request) is the single exception. `private.purge_tenant(id)`
  is security definer, lives in the unexposed `private` schema, and has EXECUTE revoked from every API role
  (service_role included). An operator runs it as `postgres` (psql). It sets a transaction-local
  `dueloop.purging_tenant` setting that the trigger honours only for that tenant's rows, and then deletes the
  tenant; every tenant-owned table cascades from it.

**Consequences.** History cannot be edited, even by mistake. Corrections are new events. Deleting a single
customer's data inside a tenant (GDPR erasure) is not covered yet; it needs a redaction design
(retention/deletion tooling is out of scope for this phase).
