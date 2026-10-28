"use server";

// Settings editors (step 10). Each mutation is re-checked in the database: holidays by RLS (owner/accountant W D),
// settings by save_tenant_settings (owner), members by set_member_role / remove_member (owner + last-owner
// trigger), API keys by create_api_key / revoke_api_key (owner). Invites and secrets run on the trusted pool
// after an owner check (lib/trusted/admin.ts).
import { validateSettings } from "@dueloop/core";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, textField, uuidField } from "@/lib/actions";
import { requireTenant } from "@/lib/session";
import { connectPaymentAccount, inviteMember, rotateWebhookToken, setChannelSecret } from "@/lib/trusted/admin";

export async function holidayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const date = textField(form, "date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose a date." };
  if (form.get("op") === "delete") {
    const { error } = await ctx.supabase.from("holidays").delete().eq("tenant_id", ctx.tenant.id).eq("on_date", date);
    if (error) return { error: dbErrorMessage(error) };
  } else {
    const label = textField(form, "label", 80).trim() || null;
    const { error } = await ctx.supabase.from("holidays").upsert({ tenant_id: ctx.tenant.id, on_date: date, label });
    if (error) return { error: dbErrorMessage(error) };
  }
  revalidatePath("/settings/holidays");
  return { ok: true, message: "Saved. No reminders are sent on holidays." };
}

export async function settingsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const timezone = textField(form, "timezone", 64).trim();
  const start = Number(form.get("quiet_start"));
  const end = Number(form.get("quiet_end"));
  // The same core validator the worker relies on (non-wrapping windows, IANA zone).
  const v = validateSettings({ timezone, quietHours: { startHour: start, endHour: end }, holidays: [] });
  if (!v.ok) return { error: v.errors.map((e) => e.message).join("; ") };
  const budgetMajor = textField(form, "budget", 20).trim();
  if (!/^\d{1,12}$/.test(budgetMajor)) return { error: "The monthly budget is a whole number of minor units (0 = no limit)." };
  const approval = String(form.get("approval_mode"));
  const promise = String(form.get("promise_acceptance"));
  if (!["always", "low_confidence", "never"].includes(approval) || !["auto", "review"].includes(promise)) return { error: "Invalid choice." };
  const { error } = await ctx.supabase.rpc("save_tenant_settings", {
    p_tenant: ctx.tenant.id,
    p: {
      timezone,
      quiet_start_hour: start,
      quiet_end_hour: end,
      approval_mode: approval,
      promise_acceptance: promise,
      monthly_message_budget_minor: budgetMajor,
      bank_instructions: textField(form, "bank_instructions", 1000),
      proof_ai_extraction: form.get("proof_ai_extraction") === "on",
    },
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}

export async function memberAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const op = form.get("op");
  if (op === "invite") {
    const email = textField(form, "email", 254).trim().toLowerCase();
    const role = String(form.get("role"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["owner", "accountant", "collector"].includes(role)) return { error: "Enter an email address and a role." };
    const r = await inviteMember(ctx, email, role as "owner" | "accountant" | "collector");
    if (!r.ok) return { error: r.reason };
    revalidatePath("/settings/members");
    // The same answer whether or not the address already had an account anywhere (no account enumeration).
    return { ok: true, message: "Invitation sent. They will appear here once they accept." };
  }
  const user = uuidField(form, "user");
  if (!user) return { error: "Invalid request." };
  if (op === "remove") {
    const { error } = await ctx.supabase.rpc("remove_member", { p_tenant: ctx.tenant.id, p_user: user });
    if (error) return { error: dbErrorMessage(error) };
  } else {
    const role = String(form.get("role"));
    const { error } = await ctx.supabase.rpc("set_member_role", { p_tenant: ctx.tenant.id, p_user: user, p_role: role });
    if (error) return { error: dbErrorMessage(error) };
  }
  revalidatePath("/settings/members");
  return { ok: true, message: "Saved." };
}

export interface KeyState extends ActionState {
  /** Shown ONCE, right after creation. Never stored in plaintext, never shown again. */
  secret?: string;
}

export async function apiKeyAction(_prev: KeyState, form: FormData): Promise<KeyState> {
  const ctx = await requireTenant();
  if (form.get("op") === "revoke") {
    const id = uuidField(form, "key");
    if (!id) return { error: "Invalid request." };
    const { error } = await ctx.supabase.rpc("revoke_api_key", { p_tenant: ctx.tenant.id, p_key: id });
    if (error) return { error: dbErrorMessage(error) };
    revalidatePath("/settings/api-keys");
    return { ok: true, message: "Revoked. Requests with this key now fail." };
  }
  const { data, error } = await ctx.supabase.rpc("create_api_key", { p_tenant: ctx.tenant.id, p_name: textField(form, "name", 80) });
  if (error || typeof data !== "string") return { error: dbErrorMessage(error) };
  revalidatePath("/settings/api-keys");
  return { ok: true, secret: data, message: "Copy this key now. It will not be shown again." };
}

export interface IntegrationState extends ActionState {
  /** The webhook URL with its opaque token, shown ONCE to the owner after connecting or rotating. */
  webhookUrl?: string;
}

export async function integrationAction(_prev: IntegrationState, form: FormData): Promise<IntegrationState> {
  const ctx = await requireTenant();
  const op = form.get("op");
  if (op === "channel_secret") {
    const channel = String(form.get("channel"));
    const r = await setChannelSecret(ctx, channel, textField(form, "secret", 4096));
    return r.ok ? { ok: true, message: "Saved. The secret cannot be shown again." } : { error: r.reason };
  }
  if (op === "connect_payment") {
    const r = await connectPaymentAccount(ctx, {
      provider: String(form.get("provider")),
      mode: String(form.get("mode")),
      apiKey: textField(form, "api_key", 4096),
      webhookSecret: textField(form, "webhook_secret", 4096),
    });
    if (!r.ok) return { error: r.reason };
    revalidatePath("/settings/integrations");
    return { ok: true, webhookUrl: r.value, message: "Connected. Copy the webhook URL into the provider now; it is not shown again." };
  }
  if (op === "rotate_webhook") {
    const r = await rotateWebhookToken(ctx);
    if (!r.ok) return { error: r.reason };
    return { ok: true, webhookUrl: r.value, message: "New webhook URL. Update it at the provider; the old one stops working now." };
  }
  return { error: "Invalid request." };
}
