# 0012: Role matrix additions for sending (prompt 3)

**Context.** Phase 3 adds templates, channel accounts with Vault-held secrets, consents, approvals,
dead letters, alert de-duplication and a global kill switch. ADR 0008 covers the earlier tables.
This table was written before the policies; migration 0007 implements exactly this.

**Decision.** R = read, W = insert + update, D = delete, - = nothing. The rows are for the user's own
tenant; other tenants' rows are invisible to everyone except the service role and the worker.

| Table / action | owner | accountant | collector | non-member / anon | worker (postgres) |
|---|---|---|---|---|---|
| templates | R W D | R W | R | - | R |
| channel_accounts (non-secret config only) | R W D | R | R | - | R |
| channel secrets (Vault) | - | - | - | - | read via `private.channel_secret()` |
| customer_consents | R W | R W | R | - | R W |
| approvals | R | R | R | - | all |
| approve / reject / edit (`public.decide_approval`, `public.edit_approval`) | yes | yes | no | no | CLI yes |
| dead_letters | R | R | - | - | all |
| notifications (alert log) | R | R | - | - | all |
| tenant kill switch (`public.set_outbound_paused`) | yes | no | no | no | CLI yes |
| `private.system_flags` (global kill switch, cron switch) | - | - | - | - | only |
| queue functions (`private.enqueue_due_actions`, claim, ack, ...) | - | - | - | - | only |

- No client role can write `messages`, `approvals`, `dead_letters` or `notifications` directly. They change
  only through the worker or the RPCs above, which check the caller's role inside the function.
- `system_flags` sits in the unexposed `private` schema, so no API role can reach it at all.
- Channel secrets are stored only in Vault (`vault.create_secret`). `channel_accounts.secret_id` is an
  opaque reference that leaks nothing. Authenticated users have no USAGE on schema `vault` (checked in a
  test), and the only reader is the worker's trusted database connection.

**Consequences.** `supabase/tests/rls/role_matrix.test.sql` covers every new public table. The RPCs have
their own allow/deny tests, and there is a test that authenticated users cannot read secrets.
