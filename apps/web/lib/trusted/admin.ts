// Owner-only admin operations that need the trusted pool or the Auth admin API (issues M, N). Every entry point
// re-checks "owner of the active tenant" in the database for the verified user id before doing anything.
// Secrets are write-only: they go to Vault through the prompt 3/5 functions and are never read back here.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { verifyPhoneNumberId } from "@dueloop/adapters-whatsapp";
import { checkBaseUrl } from "@dueloop/links";
import { createClient } from "@supabase/supabase-js";
import { channelConfigFrom, senderDomainAllowed, type ChannelConfigInput } from "@/lib/channel-config";
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
  // A business's own email password is only used with its own mail server (smtpLogin); with the operator's server
  // it would replace SMTP_PASSWORD for the operator's user and break sending (review round 2).
  if (channel === "email" && process.env.SMTP_ALLOW_TENANT_HOST !== "true") return { ok: false, reason: "This server sends email with its own login; no email password is needed here." };
  // The notifier only posts to Slack's incoming-webhook host; anything else would silently drop every alert.
  if (channel === "slack" && !secret.startsWith("https://hooks.slack.com/")) return { ok: false, reason: "A Slack webhook URL starts with https://hooks.slack.com/." };
  const pool = trustedPool();
  await pool.query("insert into public.channel_accounts (tenant_id, channel) values ($1, $2) on conflict (tenant_id, channel) do nothing", [ctx.tenant.id, channel]);
  await pool.query("select private.set_channel_secret($1, $2, $3)", [ctx.tenant.id, channel, secret]);
  return { ok: true, value: null };
}

/**
 * Non-secret channel settings (sender address, WhatsApp phone number id). Before this, nothing in the UI could set
 * them, so a new tenant could not send. Replaces only the keys this form owns; other config keys are kept.
 * WhatsApp: the phone number id is always saved for SENDING (Meta only accepts it with this business's own token).
 * Inbound replies are routed by external_account_id, so that is set only when Meta confirms, with this business's
 * token, that the token can read the number; otherwise it is cleared (review round 2: a business could claim
 * another business's number and receive its customers' replies). Value: true when Meta confirmed it.
 */
export async function setChannelConfig(ctx: TenantContext, input: ChannelConfigInput): Promise<AdminResult<boolean | null>> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can change channel settings." };
  const v = channelConfigFrom(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  if (v.channel === "email" && "smtp_host" in v.config && process.env.SMTP_ALLOW_TENANT_HOST !== "true") return { ok: false, reason: "This server does not allow your own mail server." };
  if (v.channel === "email" && !("smtp_host" in v.config) && !senderDomainAllowed(String(v.config.from_address ?? ""), process.env.SMTP_FROM_DOMAINS)) {
    return { ok: false, reason: "This server may only send from these domains: " + (process.env.SMTP_FROM_DOMAINS ?? "") + "." };
  }
  const owned = v.channel === "email" ? ["from_address", "from_name", "smtp_host", "smtp_port", "smtp_user", "smtp_secure"] : ["phone_number_id"];
  let confirmed: boolean | null = null;
  if (v.channel === "whatsapp" && v.externalAccountId) {
    const graphVersion = process.env.WHATSAPP_GRAPH_VERSION ?? "";
    const token = (await trustedPool().query<{ s: string | null }>("select private.channel_secret($1, 'whatsapp') as s", [ctx.tenant.id])).rows[0]?.s ?? "";
    confirmed = graphVersion !== "" && token !== "" && (await verifyPhoneNumberId({ graphVersion, token, phoneNumberId: v.externalAccountId, timeoutMs: 10_000 }));
  }
  const external = v.channel === "whatsapp" ? (confirmed ? v.externalAccountId : null) : undefined;
  try {
    await trustedPool().query(
      `insert into public.channel_accounts (tenant_id, channel, config, external_account_id) values ($1, $2, $3::jsonb, $4)
       on conflict (tenant_id, channel) do update
         set config = (public.channel_accounts.config - $5::text[]) || excluded.config,
             external_account_id = case when $6 then excluded.external_account_id else public.channel_accounts.external_account_id end`,
      [ctx.tenant.id, v.channel, JSON.stringify(v.config), external ?? null, owned, external !== undefined],
    );
  } catch (e) {
    // channel_accounts_external_unique: Meta confirmed the number for THIS token, yet another account routes it.
    if ((e as { code?: string }).code === "23505") return { ok: false, reason: "This phone number ID cannot be used here." };
    throw e;
  }
  return { ok: true, value: confirmed };
}

function webhookUrl(token: string): string | null {
  // `||`, not `??`: an empty WEBHOOKS_PUBLIC_URL= line (as in .env.example) must fall back too (review round 2).
  const base = checkBaseUrl(process.env.WEBHOOKS_PUBLIC_URL || process.env.PUBLIC_APP_URL);
  return base ? `${base}/webhooks/payments/${token}` : null;
}

/**
 * Connects the tenant's payment account, or replaces its secrets. A NEW account gets a webhook URL, returned ONCE.
 * Reconnecting keeps the existing URL (the provider already has it; only its hash is stored, so it cannot be shown
 * again) and returns null: "Rotate the webhook URL" makes a new one.
 * The signing secret may come later (setPaymentWebhookSecret): providers such as Stripe issue it only after the
 * endpoint (with this URL) exists. The account is ENABLED only with a signing secret for its current mode: no
 * payment link is created before (a payment we could not verify would never close the invoice), and its webhooks
 * are rejected. A mode change (test <-> live) therefore switches it off until the new mode's secret is saved.
 */
export async function connectPaymentAccount(ctx: TenantContext, i: { provider: string; mode: string; apiKey: string; webhookSecret: string }): Promise<AdminResult<string | null>> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can connect payment accounts." };
  if (!["stripe", "fake"].includes(i.provider) || !["test", "live"].includes(i.mode)) return { ok: false, reason: "Choose a provider and a mode." };
  if (i.provider === "fake" && (i.mode !== "test" || process.env.PAYMENTS_ALLOW_FAKE !== "true")) return { ok: false, reason: "The fake gateway exists for tests only." };
  // The same rule StripeGateway enforces later (a mismatch would only show up as a broken pay page).
  if (i.provider === "stripe" && !new RegExp(`^(rk|sk)_${i.mode}_`).test(i.apiKey)) return { ok: false, reason: `Use a Stripe ${i.mode} key (it starts with rk_${i.mode}_ or sk_${i.mode}_).` };
  if (i.provider === "stripe" && i.webhookSecret !== "" && !i.webhookSecret.startsWith("whsec_")) return { ok: false, reason: "A Stripe signing secret starts with whsec_." };
  if (i.apiKey.length < 8) return { ok: false, reason: "Paste the API key." };
  if (i.webhookSecret !== "" && i.webhookSecret.length < 8) return { ok: false, reason: "The webhook signing secret looks too short." };
  const token = randomBytes(32).toString("base64url");
  const url = webhookUrl(token);
  if (!url) return { ok: false, reason: "The server has no public URL configured (PUBLIC_APP_URL)." };
  const hash = createHash("sha256").update(token).digest("hex");
  const pool = trustedPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const prev = (await client.query<{ id: string; mode: string; enabled: boolean }>("select id, mode, enabled from public.payment_accounts where tenant_id = $1 and provider = $2 for update", [ctx.tenant.id, i.provider])).rows[0];
    let id: string;
    if (!prev) {
      const r = await client.query<{ id: string }>(
        "insert into public.payment_accounts (tenant_id, provider, mode, webhook_token_hash, enabled) values ($1, $2, $3, $4, false) returning id",
        [ctx.tenant.id, i.provider, i.mode, hash],
      );
      id = r.rows[0]?.id ?? "";
    } else {
      id = prev.id;
      // Same mode and no new secret (e.g. a new API key): keep the state. A mode change needs that mode's secret.
      await client.query("update public.payment_accounts set mode = $3, enabled = $4 where tenant_id = $1 and id = $2", [ctx.tenant.id, id, i.mode, prev.mode === i.mode && prev.enabled]);
    }
    await client.query("select private.set_payment_secret($1, 'api_key', $2)", [id, i.apiKey]);
    if (i.webhookSecret !== "") {
      await client.query("select private.set_payment_secret($1, 'webhook_secret', $2)", [id, i.webhookSecret]);
      await client.query("update public.payment_accounts set enabled = true where tenant_id = $1 and id = $2", [ctx.tenant.id, id]);
    }
    await client.query("commit");
    return { ok: true, value: prev ? null : url };
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Switches a payment account off (no new pay links; its webhooks are rejected). Links already sent are still
 * confirmed by polling the provider (db.account does not filter on enabled). Connecting again switches it back on. */
export async function disconnectPaymentAccount(ctx: TenantContext, provider: string): Promise<AdminResult> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can disconnect payment accounts." };
  const r = await trustedPool().query("update public.payment_accounts set enabled = false where tenant_id = $1 and provider = $2", [ctx.tenant.id, provider]);
  if ((r.rowCount ?? 0) === 0) return { ok: false, reason: "No such payment account." };
  return { ok: true, value: null };
}

/** Second step of connecting: stores the provider's webhook signing secret and switches the account on. */
export async function setPaymentWebhookSecret(ctx: TenantContext, provider: string, secret: string): Promise<AdminResult> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can set the webhook signing secret." };
  if (secret.length < 8) return { ok: false, reason: "Paste the webhook signing secret." };
  if (provider === "stripe" && !secret.startsWith("whsec_")) return { ok: false, reason: "A Stripe signing secret starts with whsec_." };
  const pool = trustedPool();
  const r = await pool.query<{ id: string }>("select id from public.payment_accounts where tenant_id = $1 and provider = $2", [ctx.tenant.id, provider]);
  const id = r.rows[0]?.id;
  if (!id) return { ok: false, reason: "Connect the payment account first." };
  await pool.query("select private.set_payment_secret($1, 'webhook_secret', $2)", [id, secret]);
  await pool.query("update public.payment_accounts set enabled = true where id = $1 and tenant_id = $2", [id, ctx.tenant.id]);
  return { ok: true, value: null };
}

export async function rotateWebhookToken(ctx: TenantContext, provider: string): Promise<AdminResult<string>> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can rotate the webhook URL." };
  const token = randomBytes(32).toString("base64url");
  const url = webhookUrl(token);
  if (!url) return { ok: false, reason: "The server has no public URL configured (PUBLIC_APP_URL)." };
  // One account per call: the token hash is unique, so writing it to every account of the tenant failed.
  const r = await trustedPool().query("update public.payment_accounts set webhook_token_hash = $3 where tenant_id = $1 and provider = $2", [ctx.tenant.id, provider, createHash("sha256").update(token).digest("hex")]);
  if ((r.rowCount ?? 0) === 0) return { ok: false, reason: "No payment account is connected." };
  return { ok: true, value: url };
}
