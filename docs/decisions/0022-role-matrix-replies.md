# 0022: Role matrix additions for replies and promises (prompt 4)

**Context.** Phase 4 stores inbound provider events, inbound messages, promises, human tasks and
tenant-level events. ADRs 0008 and 0012 cover the earlier tables. This table was written before the
policies; the phase 4 migration implements exactly this.

**Decision.** R = read, W = insert + update, D = delete, - = nothing. Rows are for the user's own tenant.

| Table / action | owner | accountant | collector | non-member / anon | worker / processor (postgres) |
|---|---|---|---|---|---|
| inbound_events (raw provider payloads, PII) | - | - | - | - | all |
| messages, direction 'in' (the inbox) | R | R | R | - | all |
| promises | R | R | R | - | all |
| cancel a promise (`public.cancel_promise`) | yes | yes | no | no | CLI yes |
| tasks | R | R | R | - | all |
| resolve / reopen a task (`public.resolve_task`, `public.reopen_task`) | yes | yes | yes | no | CLI yes |
| tenant_events (append-only) | R | R | R | - | insert only |
| tenants.promise_acceptance | W (owner only, via tenant settings) | - | - | - | R |
| channel_accounts.external_account_id | R W (as the rest of channel_accounts) | R | R | - | R |
| apply a reply plan (`private.apply_reply_plan`) | - | - | - | - | only |

- Raw inbound payloads are readable by no client role. They are PII and are purged on schedule (rule 25).
  The inbox shows the normalised message only, and its `analysis.summary` is marked untrusted.
- Nobody writes `promises` directly: the processor creates and supersedes them, the worker marks them
  broken, and owner/accountant cancel through `cancel_promise` (so a promise always has a source message).
- Nobody writes `tasks` directly. Tasks change only through `resolve_task` / `reopen_task`, which record
  who resolved them and why.
- A collector may read the inbox and work tasks, but cannot edit promises, settings or channel accounts.
- `tenant_events` has the same immutability as `invoice_events`: no update, no delete, for any role.
