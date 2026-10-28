"use server";

// Policy editor (issue K). "Check impact" is read-only (count + decide() preview). "Save" calls save_policy, which
// checks the role, assigns ids to new steps, refuses invented/reused ids and refreshes next_action_at for the
// policy's open invoices in the same transaction (decide() and the send protocol stay the authority).
import { revalidatePath } from "next/cache";
import { dbErrorMessage } from "@/lib/actions";
import { policyImpact, previewOnSamples, type StepInput } from "@/lib/data/policies";
import { requireTenant } from "@/lib/session";

export interface PolicyState {
  error?: string;
  message?: string;
  impact?: { invoices: number; lines: { invoiceNumber: string; outcome: string }[] };
  /** What was submitted, so the form shows the edit again (React resets form fields after an action). */
  draft?: { name: string; steps: { id: string; daysAfterDue: number; channel: string; templateKey: string }[]; escalate: number; grace: number; maxWeek: number };
}

const CHANNELS = ["email", "whatsapp", "sms"];

function read(form: FormData) {
  const ids = form.getAll("step_id").map(String);
  const days = form.getAll("step_days").map(String);
  const channels = form.getAll("step_channel").map(String);
  const templates = form.getAll("step_template").map(String);
  const removed = new Set(form.getAll("step_remove").map(String));
  const steps: StepInput[] = [];
  for (let i = 0; i < days.length; i++) {
    const id = ids[i] && /^[A-Za-z0-9_-]{1,40}$/.test(ids[i] ?? "") ? (ids[i] ?? null) : null;
    if (id && removed.has(id)) continue;
    const d = (days[i] ?? "").trim();
    if (d === "" && !id) continue; // the blank "add a step" row
    steps.push({ id, daysAfterDue: Number(d), channel: CHANNELS.includes(channels[i] ?? "") ? (channels[i] ?? "email") : "email", templateKey: (templates[i] ?? "").trim() });
  }
  const num = (k: string) => Number(String(form.get(k) ?? ""));
  return { policyId: String(form.get("policy") ?? ""), isDefault: form.get("is_default") === "true", name: String(form.get("name") ?? "").slice(0, 80), steps, escalate: num("escalate"), grace: num("grace"), maxWeek: num("max_week") };
}

export async function policyAction(_prev: PolicyState, form: FormData): Promise<PolicyState> {
  const ctx = await requireTenant();
  const p = read(form);
  if (!/^[0-9a-f-]{36}$/.test(p.policyId)) return { error: "Invalid request." };
  const draft = { name: p.name, steps: p.steps.map((s) => ({ ...s, id: s.id ?? "" })), escalate: p.escalate, grace: p.grace, maxWeek: p.maxWeek };
  if (p.steps.some((s) => !Number.isInteger(s.daysAfterDue) || s.daysAfterDue < 0 || s.daysAfterDue > 365)) return { draft, error: "Days after due must be a whole number from 0 to 365." };
  if (form.get("op") === "impact") {
    const pv = await previewOnSamples(ctx, p.policyId, p.isDefault, p);
    if (!pv.ok) return { draft, error: `The policy is not valid: ${pv.errors.join("; ")}` };
    return { draft, impact: { invoices: await policyImpact(ctx, p.policyId, p.isDefault), lines: pv.lines } };
  }
  if (form.get("confirm") !== "1") return { draft, error: "Check the impact first, then confirm." };
  const { data, error } = await ctx.supabase.rpc("save_policy", {
    p_tenant: ctx.tenant.id,
    p_policy: p.policyId,
    p_name: p.name,
    p_steps: p.steps.map((s) => ({ id: s.id, daysAfterDue: s.daysAfterDue, channel: s.channel, templateKey: s.templateKey })),
    p_escalate: p.escalate,
    p_grace: p.grace,
    p_max_week: p.maxWeek,
  });
  if (error) return { draft, error: dbErrorMessage(error) };
  revalidatePath("/settings/policies");
  const refreshed = data && typeof data === "object" && !Array.isArray(data) ? Number((data as { refreshed?: unknown }).refreshed ?? 0) : 0;
  return { message: `Saved. ${refreshed} open invoices will be re-checked by the scheduler; steps already sent are never sent again.` };
}
