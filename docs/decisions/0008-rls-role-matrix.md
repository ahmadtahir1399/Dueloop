# 0008: RLS role matrix

**Context.** Staff of a client business sign in as `authenticated` users and belong to tenants through
`memberships` with one of three roles. Workers and the import CLI use the service role, which bypasses
RLS and must stay server-side. Signed-out visitors (`anon`) have no business in this data.

**Decision.** Written before the policies; migration 0003 implements exactly this. R = read, W = insert +
update, D = delete, - = nothing. "Own tenant" means a tenant the user is a member of. Rows of other tenants
are invisible and unwritable for everyone except the service role.

| Table | owner | accountant | collector | non-member | anon | service_role |
|---|---|---|---|---|---|---|
| tenants | R, update | R | R | - | - | all |
| memberships | R W D | R | R | - | - | all |
| customers | R W D | R W | R | - | - | all |
| policies | R W D | R W D | R | - | - | all |
| holidays | R W D | R W D | R | - | - | all |
| invoices | R W (no D) | R W (no D) | R | - | - | all |
| invoice_events | R | R | R | - | - | insert only (see ADR 0009) |
| messages, message_invoices | R | R | R | - | - | all |
| payments | R | R | R | - | - | all |
| import_batches, import_rows | R, insert | R, insert | - | - | - | all |
| views invoice_balances, invoices_due | R (security_invoker) | R | R | - | - | R |
| `commit_import_batch()` RPC | execute | execute | denied | denied | denied | execute |

- Nobody creates tenants from the client yet (sign-up is prompt 6); invoices are never deleted (void them).
- Writes to events and payments come only from the service role or vetted functions (prompts 3, 5, 6).
- Mechanism: grants are revoked and re-granted per table (anon gets none). Policies are `to authenticated`
  with `tenant_id in (select private.my_tenant_ids(<roles>))`. The helper is security definer in the
  unexposed `private` schema, returns a set that does not depend on the row (so the `(select ...)` initPlan
  runs once per statement), and filters `memberships (user_id, tenant_id)` by index.

**Consequences.** `supabase/tests/rls/role_matrix.test.sql` checks every cell above for both own-tenant and
other-tenant rows. Changing a cell means changing this table, the policy and the test together.
