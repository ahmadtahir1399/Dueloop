// Step 8, issue H: skip the UI entirely. Each role signs in with its real password and calls every user-facing
// RPC directly with its own token (the "UI hides, DB decides" check). The expectation for each call comes from
// the role matrix DATA; a 42501 is "denied", anything else (success, not found, validation) is "allowed through
// the role check". The outsider is denied on every Demo Agency object.
import { can, type PermissionId } from "@dueloop/authz";
import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { db } from "../support/db";
import { stack } from "../support/stack";
import { DEMO_TENANT, E2E_PASSWORD, USERS, type E2eUser } from "../support/users";

async function as(user: E2eUser): Promise<SupabaseClient> {
  const s = stack();
  const c = createClient(s.apiUrl, s.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await c.auth.signInWithPassword({ email: USERS[user].email, password: E2E_PASSWORD });
  if (r.error) throw new Error(`sign-in failed for ${user}`);
  return c;
}

async function freshObjects() {
  const inv = (await db().query("select id, customer_id from public.invoices where tenant_id = $1 and number = 'DA-0016'", [DEMO_TENANT])).rows[0];
  const key = `bypass-${Math.random().toString(36).slice(2)}`;
  const approval = (await db().query("insert into public.approvals (tenant_id, invoice_id, idempotency_key, step_id, channel, requested_at) values ($1, $2, $3, 's1', 'email', now()) returning id", [DEMO_TENANT, inv.id, key])).rows[0].id;
  const task = (await db().query("insert into public.tasks (tenant_id, type, status, invoice_id, customer_id, dedupe_key, created_at) values ($1, 'human_review', 'open', $2, $3, $4, now()) returning id", [DEMO_TENANT, inv.id, inv.customer_id, key])).rows[0].id;
  await db().query("update public.promises set status = 'cancelled', resolved_at = now() where invoice_id = $1 and status = 'active'", [inv.id]);
  const promise = (await db().query("insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, status, reference_at) values ($1, $2, $3, current_date + 3, 'active', now()) returning id", [DEMO_TENANT, inv.id, inv.customer_id])).rows[0].id;
  const member = (await db().query("select user_id from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = $1 and u.email = 'collector@e2e.test'", [DEMO_TENANT])).rows[0].user_id;
  // An empty staged batch (commit_import_batch looks the batch up before the role check, so it must exist).
  const batch = (await db().query("insert into public.import_batches (tenant_id, file_name, file_sha256, mapping, options) values ($1, 'bypass.csv', repeat('a', 64), '{}', '{}') returning id", [DEMO_TENANT])).rows[0].id;
  return { approval, task, promise, member, batch };
}

type Call = { name: string; permission: PermissionId; run: (c: SupabaseClient, o: Awaited<ReturnType<typeof freshObjects>>) => PromiseLike<{ error: { code?: string } | null }> };

const CALLS: Call[] = [
  { name: "decide_approval", permission: "approvals.decide", run: (c, o) => c.rpc("decide_approval", { p_approval_id: o.approval, p_decision: "approve" }) },
  { name: "edit_approval", permission: "approvals.decide", run: (c, o) => c.rpc("edit_approval", { p_approval_id: o.approval, p_subject: "s", p_body: "b" }) },
  { name: "resolve_task", permission: "tasks.resolve", run: (c, o) => c.rpc("resolve_task", { p_task_id: o.task, p_note: "bypass test" }) },
  { name: "cancel_promise", permission: "promises.cancel", run: (c, o) => c.rpc("cancel_promise", { p_promise_id: o.promise, p_note: "bypass test" }) },
  { name: "set_outbound_paused", permission: "killswitch.toggle", run: (c) => c.rpc("set_outbound_paused", { p_tenant_id: DEMO_TENANT, p_paused: false }) },
  { name: "set_member_role", permission: "members.manage", run: (c, o) => c.rpc("set_member_role", { p_tenant: DEMO_TENANT, p_user: o.member, p_role: "collector" }) },
  { name: "audit_export", permission: "export.audit", run: (c) => c.rpc("audit_export", { p_tenant: DEMO_TENANT, p_from: "2026-01-01T00:00:00Z", p_to: "2026-01-02T00:00:00Z", p_max: 1 }) },
  { name: "log_list_export", permission: "export.lists", run: (c) => c.rpc("log_list_export", { p_tenant: DEMO_TENANT, p_list: "invoices", p_rows: 0 }) },
  { name: "list_members", permission: "members.view", run: (c) => c.rpc("list_members", { p_tenant: DEMO_TENANT }) },
  { name: "commit_import_batch", permission: "import.run", run: (c, o) => c.rpc("commit_import_batch", { p_batch_id: o.batch, p_dry_run: true, p_skip_invalid_rows: false }) },
];

for (const user of ["owner", "accountant", "collector", "outsider"] as const) {
  test(`direct RPC calls as ${user} match the role matrix`, async () => {
    const client = await as(user);
    const role = user === "outsider" ? null : USERS[user].memberships[0]?.role ?? null;
    const results: string[] = [];
    for (const call of CALLS) {
      const o = await freshObjects();
      const { error } = await call.run(client, o);
      const denied = error?.code === "42501";
      const expected = role !== null && can(role, call.permission);
      results.push(`${call.name}: ${denied ? "denied" : "allowed"}`);
      expect(denied, `${user} ${call.name} (error ${error?.code ?? "none"})`).toBe(!expected);
    }
    // Direct table writes are blocked by RLS as well (no client role writes these tables).
    const o = await freshObjects();
    const w = await client.from("approvals").update({ status: "approved" }).eq("id", o.approval).select("id");
    expect(w.data ?? []).toEqual([]);
    const t = await client.from("tasks").update({ status: "resolved" }).eq("id", o.task).select("id");
    expect(t.data ?? []).toEqual([]);
    test.info().annotations.push({ type: "matrix", description: results.join("; ") });
  });
}
