import "server-only";
import { policyRowToPolicy } from "@dueloop/db";
import type { Policy } from "@dueloop/core";
import { loadContext, toCtx, WorkerDb } from "@dueloop/worker";
import { previewPolicy } from "@/lib/policy-preview";
import type { TenantContext } from "@/lib/session";
import { trustedPool } from "@/lib/trusted/db";

export interface StepInput {
  id: string | null;
  daysAfterDue: number;
  channel: string;
  templateKey: string;
}

export async function listPolicies(ctx: TenantContext) {
  const { data, error } = await ctx.supabase
    .from("policies")
    .select("id, name, steps, escalate_after_days, grace_days_after_promise, max_messages_per_week, is_default")
    .eq("tenant_id", ctx.tenant.id)
    .order("is_default", { ascending: false })
    .order("name");
  if (error) throw new Error("could not load policies");
  return data ?? [];
}

/** Invoices whose next action would be refreshed by a save (non-final, not parked; RLS read). */
export async function policyImpact(ctx: TenantContext, policyId: string, isDefault: boolean): Promise<number> {
  let q = ctx.supabase.from("invoices").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id).in("status", ["open", "overdue", "promised", "escalated"]).is("parked_reason", null);
  q = isDefault ? q.or(`policy_id.eq.${policyId},policy_id.is.null`) : q.eq("policy_id", policyId);
  const { count, error } = await q;
  if (error) throw new Error("could not count invoices");
  return count ?? 0;
}

/** decide() on up to 5 of the policy's invoices with the edited steps (injected clock = now). Read-only. */
export async function previewOnSamples(ctx: TenantContext, policyId: string, isDefault: boolean, edited: { steps: StepInput[]; escalate: number; grace: number; maxWeek: number }) {
  const parsed = policyRowToPolicy({
    steps: edited.steps.map((s, i) => ({ id: s.id ?? `new_${i + 1}`, daysAfterDue: s.daysAfterDue, channel: s.channel, templateKey: s.templateKey })),
    escalate_after_days: edited.escalate,
    grace_days_after_promise: edited.grace,
    max_messages_per_week: edited.maxWeek,
  });
  if (!parsed.ok) return { ok: false as const, errors: parsed.errors.map((e) => `${e.field}: ${e.message}`) };
  const policy: Policy = parsed.value;
  let q = ctx.supabase.from("invoices").select("id, number").eq("tenant_id", ctx.tenant.id).in("status", ["open", "overdue", "promised", "escalated"]).order("due_on").limit(5);
  q = isDefault ? q.or(`policy_id.eq.${policyId},policy_id.is.null`) : q.eq("policy_id", policyId);
  const { data } = await q;
  const db = new WorkerDb(trustedPool());
  const now = new Date();
  const lines: { invoiceNumber: string; outcome: string }[] = [];
  for (const inv of data ?? []) {
    const loaded = await loadContext(db, ctx.tenant.id, inv.id);
    if (!loaded.ok) continue;
    lines.push({ invoiceNumber: inv.number, outcome: previewPolicy(toCtx(loaded.ctx, now), policy, now) });
  }
  return { ok: true as const, lines };
}
