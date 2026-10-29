// Owner-only admin operations that need the trusted pool or the Auth admin API (issues M, N). Every entry point
// re-checks "owner of the active tenant" in the database for the verified user id before doing anything.
// Secrets are write-only: they go to Vault through the prompt 3/5 functions and are never read back here.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { checkBaseUrl } from "@dueloop/links";
import { createClient } from "@supabase/supabase-js";
import { channelConfigFrom, type ChannelConfigInput } from "@/lib/channel-config";
import type { TenantContext } from "@/lib/session";
import { trustedPool } from "./db";
import { serviceRoleKey, supabaseUrl } from "./env";

export type AdminResult<T = null> = { ok: true; value: T } | { ok: false; reason: string };

async function isOwner(ctx: TenantContext): Promise<boolean> {
  const r = await trustedPool().query<{ ok: boolean }>("select private.member_has_role($1, $2, array['owner']) as ok", [ctx.tenant.id, ctx.userId]);
  return r.rows[0]?.ok === true;
}

function admin() {
  return createClient(supabaseUrl(), serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Invite (Supabase Auth admin `inviteUserByEmail`, server-side only; Supabase docs "auth.admin.inviteUserByEmail").
 * If the address already has an account (perhaps in another tenant), it is added to this tenant without an
 * email. The caller gets the SAME answer in both cases, so the form cannot be used to probe for accounts.
 */
export async function inviteMember(ctx: TenantContext, email: string, role: "owner" | "accountant" | "collector"): Promise<AdminResult> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can invite members." };
  const pool = trustedPool();
  const existing = await pool.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email]);
  let userId = existing.rows[0]?.id;
  if (!userId) {
    const base = checkBaseUrl(process.env.PUBLIC_APP_URL);
    const r = await admin().auth.admin.inviteUserByEmail(email, base ? { redirectTo: `${base}/auth/confirm?next=/` } : undefined);
    if (r.error || !r.data.user) return { ok: false, reason: "The invitation could not be sent. Try again later." };
    userId = r.data.user.id;
  }
  await pool.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, $3) on conflict (tenant_id, user_id) do nothing", [ctx.tenant.id, userId, role]);
  return { ok: true, value: null };
}

const CHANNEL_SECRETS = new Set(["email", "whatsapp", "slack"]);

export async function setChannelSecret(ctx: TenantContext, channel: string, secret: string): Promise<AdminResult> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can set secrets." };
  if (!CHANNEL_SECRETS.has(channel) || secret.length < 8) return { ok: false, reason: "Choose a channel and paste the secret." };
  const pool = trustedPool();
  await pool.query("insert into public.channel_accounts (tenant_id, channel) values ($1, $2) on conflict (tenant_id, channel) do nothing", [ctx.tenant.id, channel]);
  await pool.query("select private.set_channel_secret($1, $2, $3)", [ctx.tenant.id, channel, secret]);
  return { ok: true, value: null };
}

/**
 * Non-secret channel settings (sender address, WhatsApp phone number id). Before this, nothing in the UI could set
 * them, so a new tenant could not send. Replaces only the keys this form owns; other config keys are kept.
 */
export async function setChannelConfig(ctx: TenantContext, input: ChannelConfigInput): Promise<AdminResult> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can change channel settings." };
  const v = channelConfigFrom(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  const owned = v.channel === "email" ? ["from_address", "from_name"] : ["phone_number_id"];
  try {
    await trustedPool().query(
      `insert into public.channel_accounts (tenant_id, channel, config, external_account_id) values ($1, $2, $3::jsonb, $4)
       on conflict (tenant_id, channel) do update
         set config = (public.channel_accounts.config - $5::text[]) || excluded.config,
             external_account_id = coalesce(excluded.external_account_id, public.channel_accounts.external_account_id)`,
      [ctx.tenant.id, v.channel, JSON.stringify(v.config), v.externalAccountId, owned],
    );
  } catch (e) {
    // channel_accounts_external_unique: the same WhatsApp number is already connected (possibly to another
    // tenant). Say only that it cannot be used here.
    if ((e as { code?: string }).code === "23505") return { ok: false, reason: "This phone number ID cannot be used here." };
    throw e;
  }
  return { ok: true, value: null };
}

function webhookUrl(token: string): string | null {
  const base = checkBaseUrl(process.env.WEBHOOKS_PUBLIC_URL ?? process.env.PUBLIC_APP_URL);
  return base ? `${base}/webhooks/payments/${token}` : null;
}

/**
 * Connects (or replaces the secrets of) the tenant's payment account and returns the webhook URL ONCE.
 * The signing secret may come later (setPaymentWebhookSecret): providers such as Stripe issue it only after the
 * endpoint (with this URL) exists. Without a signing secret the account stays DISABLED: no payment link is
 * created (a payment we could not verify would never close the invoice) and its webhooks are rejected.
 */
export async function connectPaymentAccount(ctx: TenantContext, i: { provider: string; mode: string; apiKey: string; webhookSecret: string }): Promise<AdminResult<string>> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can connect payment accounts." };
  if (!["stripe", "fake"].includes(i.provider) || !["test", "live"].includes(i.mode)) return { ok: false, reason: "Choose a provider and a mode." };
  if (i.provider === "fake" && i.mode !== "test") return { ok: false, reason: "The fake gateway exists for tests only." };
  if (i.apiKey.length < 8) return { ok: false, reason: "Paste the API key." };
  if (i.webhookSecret !== "" && i.webhookSecret.length < 8) return { ok: false, reason: "The webhook signing secret looks too short." };
  const token = randomBytes(32).toString("base64url");
  const url = webhookUrl(token);
  if (!url) return { ok: false, reason: "The server has no public URL configured (PUBLIC_APP_URL)." };
  const hash = createHash("sha256").update(token).digest("hex");
  const pool = trustedPool();
  const r = await pool.query<{ id: string }>(
    `insert into public.payment_accounts (tenant_id, provider, mode, webhook_token_hash, enabled) values ($1, $2, $3, $4, $5)
     on conflict (tenant_id, provider) do update set mode = excluded.mode, webhook_token_hash = excluded.webhook_token_hash,
       enabled = excluded.enabled or public.payment_accounts.webhook_secret_id is not null
     returning id`,
    [ctx.tenant.id, i.provider, i.mode, hash, i.webhookSecret !== ""],
  );
  const id = r.rows[0]?.id;
  if (!id) return { ok: false, reason: "Could not save the account." };
  await pool.query("select private.set_payment_secret($1, 'api_key', $2)", [id, i.apiKey]);
  if (i.webhookSecret !== "") await pool.query("select private.set_payment_secret($1, 'webhook_secret', $2)", [id, i.webhookSecret]);
  return { ok: true, value: url };
}

/** Second step of connecting: stores the provider's webhook signing secret and switches the account on. */
export async function setPaymentWebhookSecret(ctx: TenantContext, provider: string, secret: string): Promise<AdminResult> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can set the webhook signing secret." };
  if (secret.length < 8) return { ok: false, reason: "Paste the webhook signing secret." };
  const pool = trustedPool();
  const r = await pool.query<{ id: string }>("select id from public.payment_accounts where tenant_id = $1 and provider = $2", [ctx.tenant.id, provider]);
  const id = r.rows[0]?.id;
  if (!id) return { ok: false, reason: "Connect the payment account first." };
  await pool.query("select private.set_payment_secret($1, 'webhook_secret', $2)", [id, secret]);
  await pool.query("update public.payment_accounts set enabled = true where id = $1 and tenant_id = $2", [id, ctx.tenant.id]);
  return { ok: true, value: null };
}

export async function rotateWebhookToken(ctx: TenantContext): Promise<AdminResult<string>> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can rotate the webhook URL." };
  const token = randomBytes(32).toString("base64url");
  const url = webhookUrl(token);
  if (!url) return { ok: false, reason: "The server has no public URL configured (PUBLIC_APP_URL)." };
  const r = await trustedPool().query("update public.payment_accounts set webhook_token_hash = $2 where tenant_id = $1", [ctx.tenant.id, createHash("sha256").update(token).digest("hex")]);
  if ((r.rowCount ?? 0) === 0) return { ok: false, reason: "No payment account is connected." };
  return { ok: true, value: url };
}
