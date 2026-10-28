// Owner-only admin operations that need the trusted pool or the Auth admin API (issues M, N). Every entry point
// re-checks "owner of the active tenant" in the database for the verified user id before doing anything.
// Secrets are write-only: they go to Vault through the prompt 3/5 functions and are never read back here.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { checkBaseUrl } from "@dueloop/links";
import { createClient } from "@supabase/supabase-js";
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

function webhookUrl(token: string): string | null {
  const base = checkBaseUrl(process.env.WEBHOOKS_PUBLIC_URL ?? process.env.PUBLIC_APP_URL);
  return base ? `${base}/webhooks/payments/${token}` : null;
}

/** Connects (or replaces the secrets of) the tenant's payment account and returns the webhook URL ONCE. */
export async function connectPaymentAccount(ctx: TenantContext, i: { provider: string; mode: string; apiKey: string; webhookSecret: string }): Promise<AdminResult<string>> {
  if (!(await isOwner(ctx))) return { ok: false, reason: "Only an owner can connect payment accounts." };
  if (!["stripe", "fake"].includes(i.provider) || !["test", "live"].includes(i.mode)) return { ok: false, reason: "Choose a provider and a mode." };
  if (i.provider === "fake" && i.mode !== "test") return { ok: false, reason: "The fake gateway exists for tests only." };
  if (i.apiKey.length < 8 || i.webhookSecret.length < 8) return { ok: false, reason: "Paste the API key and the webhook signing secret." };
  const token = randomBytes(32).toString("base64url");
  const url = webhookUrl(token);
  if (!url) return { ok: false, reason: "The server has no public URL configured (PUBLIC_APP_URL)." };
  const hash = createHash("sha256").update(token).digest("hex");
  const pool = trustedPool();
  const r = await pool.query<{ id: string }>(
    `insert into public.payment_accounts (tenant_id, provider, mode, webhook_token_hash) values ($1, $2, $3, $4)
     on conflict (tenant_id, provider) do update set mode = excluded.mode, webhook_token_hash = excluded.webhook_token_hash, enabled = true
     returning id`,
    [ctx.tenant.id, i.provider, i.mode, hash],
  );
  const id = r.rows[0]?.id;
  if (!id) return { ok: false, reason: "Could not save the account." };
  await pool.query("select private.set_payment_secret($1, 'api_key', $2)", [id, i.apiKey]);
  await pool.query("select private.set_payment_secret($1, 'webhook_secret', $2)", [id, i.webhookSecret]);
  return { ok: true, value: url };
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
