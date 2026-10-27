# 0005: Schema conventions (tenant_id everywhere, composite foreign keys)

**Context.** The guide's draft schema referenced parents by `id` only (`invoices.customer_id ->
customers(id)`). Nothing forced the child and parent to share a tenant, so a row in tenant A could point
at tenant B's customer. RLS does not help, because FK checks bypass RLS (issue B, test
`issue_b_composite_fk`).

**Decision.**
- Every tenant-owned table has `tenant_id not null references tenants on delete cascade`. `tenants` is the
  only table without one, because its `id` is the tenant id.
- Every parent has `unique (tenant_id, id)`. Every child references the parent with a composite FK
  `(tenant_id, parent_id) -> parent (tenant_id, id)`. The same pattern carries extra invariants:
  `payments (tenant_id, invoice_id, currency) -> invoices (tenant_id, id, currency)` makes a payment's
  currency equal its invoice's (issue G).
- Arrays never hold references. `messages.invoice_ids uuid[]` became the `message_invoices` join table.
- Money is `bigint` minor units with a `char(3)` upper-case currency; instants are `timestamptz`; dates
  are `date`; zones are IANA names (trigger, ADR 0007/issue I). Status and channel CHECK lists equal core.
- **No unique constraint on customer email or phone.** Two customers can legitimately share a mailbox
  (a bookkeeper serving two firms) or a switchboard number. Deduplication is an import rule (ADR 0010).
  Emails are stored normalised (`email = lower(btrim(email))`, CHECK) so lookups are exact.
- Exposure is opt-in: default grants on `public` are revoked; each table grants exactly what ADR 0008 says.

**Consequences.** Cross-tenant attachment is impossible at the database level, whatever the client sends.
Every new table must follow this; `catalog.test.sql` fails if a public table lacks `tenant_id` or RLS.
