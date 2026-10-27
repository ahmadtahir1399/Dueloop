# 0007: Invoice status transitions are enforced by the database

**Context.** Guide 3.3 says illegal transitions are rejected "in code and by a database constraint". A
CHECK constraint cannot compare the old and new row, so the draft only limited the allowed values
(issue D, test `issue_d_transitions`).

**Decision.**
- `private.invoice_status_transitions (event, from_status, to_status)` holds the legal transitions as data:
  exactly core's `TRANSITIONS` table, one row per (event, from). It sits in the unexposed `private` schema
  because it is reference data with no `tenant_id`.
- Trigger `invoices_guard` (BEFORE INSERT OR UPDATE):
  - a new invoice must start `open` (any other state is reached through legal transitions);
  - a status change from `paid`, `written_off` or `cancelled` is always rejected;
  - any other change must match a (from, to) row. Setting the same status again is not a change.
- Errors use SQLSTATE 23514 with a message naming the transition.
- A drift test (`packages/db/test-db/drift.test.ts`) compares the table to core's `TRANSITIONS`, and the
  status CHECK list to core's `InvoiceStatus`. `transitions_all_pairs.test.sql` checks all 64 pairs
  against a list written independently from guide 3.3.

**Consequences.** Even the service role cannot skip states. The trigger only knows (from, to), not which
event caused it. Code that wants the event recorded writes an `invoice_events` row (prompt 3 onward).
Changing the state machine means changing core, this table (in a new migration) and the tests together;
the drift test fails until all three agree.
