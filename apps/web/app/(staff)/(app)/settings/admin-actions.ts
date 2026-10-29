"use server";

// Settings editors (step 10). Each mutation is re-checked in the database: holidays by RLS (owner/accountant W D),
// settings by save_tenant_settings (owner), members by set_member_role / remove_member (owner + last-owner
// trigger), API keys by create_api_key / revoke_api_key (owner). Invites and secrets run on the trusted pool
// after an owner check (lib/trusted/admin.ts).
import { validateSettings } from "@dueloop/core";
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, textField, uuidField } from "@/lib/actions";
import { requireTenant } from "@/lib/session";
import { connectPaymentAccount, inviteMember, rotateWebhookToken, setChannelConfig, setChannelSecret, setPaymentWebhookSecret, disconnectPaymentAccount } from "@/lib/trusted/admin";

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
  if (!/^\d{1,12}$/.test(budgetMajor)) return { error: "The monthly budget is a whole number of minor units (0 blocks WhatsApp and SMS)." };
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
  if (op === "channel_config") {
    const channel = String(form.get("channel"));
    const r = await setChannelConfig(
      ctx,
      channel === "whatsapp"
        ? { channel: "whatsapp", phoneNumberId: textField(form, "phone_number_id", 64) }
        : channel === "email"
          ? {
              channel: "email",
              fromAddress: textField(form, "from_address", 320),
              fromName: textField(form, "from_name", 200),
              smtp: textField(form, "smtp_host", 300).trim()
                ? { host: textField(form, "smtp_host", 300), port: textField(form, "smtp_port", 10), user: textField(form, "smtp_user", 300), secure: form.get("smtp_secure") === "on" }
                : undefined,
            }
          : ({ channel } as never),
    );
    if (!r.ok) return { error: r.reason };
    revalidatePath("/settings/integrations");
    if (r.value === false) {
      return {
        ok: true,
        message:
          "Saved for sending. Customer replies reach the app only after Meta confirms this number: save the WhatsApp access token first, then save the number again.",
      };
    }
    return { ok: true, message: r.value ? "Saved. Meta confirmed this number." : "Saved." };
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
    const later = form.get("webhook_secret") ? "" : " If it shows as switched off, add the webhook signing secret below.";
    if (r.value === null) return { ok: true, message: `Saved. The webhook URL is unchanged (use "Rotate webhook URL" if you lost it).${later}` };
    return { ok: true, webhookUrl: r.value, message: `Connected. Copy the webhook URL into the provider now; it is not shown again. It stays switched off until you add the webhook signing secret below.` };
  }
  if (op === "disconnect_payment") {
    const r = await disconnectPaymentAccount(ctx, String(form.get("provider")));
    if (!r.ok) return { error: r.reason };
    revalidatePath("/settings/integrations");
    return { ok: true, message: "Switched off. No new pay links are made; payments on links already sent are still checked." };
  }
  if (op === "webhook_secret") {
    const r = await setPaymentWebhookSecret(ctx, String(form.get("provider")), textField(form, "webhook_secret", 4096));
    if (!r.ok) return { error: r.reason };
    revalidatePath("/settings/integrations");
    return { ok: true, message: "Saved. The account is switched on. The secret cannot be shown again." };
  }
  if (op === "rotate_webhook") {
    const r = await rotateWebhookToken(ctx, String(form.get("provider")));
    if (!r.ok) return { error: r.reason };
    return { ok: true, webhookUrl: r.value, message: "New webhook URL. Update it at the provider; the old one stops working now." };
  }
  return { error: "Invalid request." };
}
