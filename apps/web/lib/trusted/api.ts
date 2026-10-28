// REST API support (ADR 0048, issue O): API key verification, the idempotency store, and the service-role
// client used ONLY to stage and commit through the same RPCs as the CSV import. Server-only.
import "server-only";
import { createHash } from "node:crypto";
import { sameDigest } from "@dueloop/links";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@dueloop/db";
import { trustedPool } from "./db";
import { serviceRoleKey, supabaseUrl } from "./env";

const KEY = /^dl_([a-z0-9]{8})_([A-Za-z0-9_-]{43,44})$/;

export interface ApiCaller {
  keyId: string;
  tenantId: string;
  scopes: string[];
  timezone: string;
  currency: string;
}

/** Bearer dl_<prefix>_<secret>: lookup by prefix, timing-safe hash compare, revocation and scope. One answer for every failure. */
export async function verifyApiKey(authorization: string | null): Promise<ApiCaller | null> {
  const m = KEY.exec((authorization ?? "").replace(/^Bearer\s+/i, "").trim());
  const prefix = m?.[1] ?? "00000000";
  const secret = m?.[2] ?? "x";
  const r = await trustedPool().query<{ id: string; tenant_id: string; secret_hash: string; scopes: string[]; revoked_at: Date | null; timezone: string; currency: string }>(
    `select k.id, k.tenant_id, k.secret_hash, k.scopes, k.revoked_at, t.timezone, t.currency
     from public.api_keys k join public.tenants t on t.id = k.tenant_id where k.prefix = $1`,
    [prefix],
  );
  const row = r.rows[0];
  const digest = createHash("sha256").update(secret, "utf8").digest("hex");
  // Compare even when there is no row, so a wrong prefix and a wrong secret cost the same work.
  const match = sameDigest(digest, row?.secret_hash ?? "0".repeat(64));
  if (!m || !row || !match || row.revoked_at) return null;
  await trustedPool().query("update public.api_keys set last_used_at = now() where id = $1", [row.id]);
  return { keyId: row.id, tenantId: row.tenant_id, scopes: row.scopes, timezone: row.timezone, currency: row.currency };
}

export const IDEMPOTENCY_WINDOW_HOURS = 24;

export type IdemClaim = { kind: "new" } | { kind: "replay"; status: number; response: unknown } | { kind: "conflict" } | { kind: "in_progress" };

/** Claims an Idempotency-Key for this exact request body. Concurrent identical calls: one runs, the others wait. */
export async function claimIdempotency(tenantId: string, key: string, requestHash: string): Promise<IdemClaim> {
  const pool = trustedPool();
  await pool.query("delete from public.api_idempotency where tenant_id = $1 and idem_key = $2 and expires_at < now()", [tenantId, key]);
  const ins = await pool.query(
    `insert into public.api_idempotency (tenant_id, idem_key, request_hash, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))
     on conflict (tenant_id, idem_key) do nothing`,
    [tenantId, key, requestHash, IDEMPOTENCY_WINDOW_HOURS],
  );
  if ((ins.rowCount ?? 0) === 1) return { kind: "new" };
  const r = await pool.query<{ request_hash: string; status: number | null; response: unknown }>("select request_hash, status, response from public.api_idempotency where tenant_id = $1 and idem_key = $2", [tenantId, key]);
  const row = r.rows[0];
  if (!row) return { kind: "in_progress" };
  if (row.request_hash !== requestHash) return { kind: "conflict" };
  if (row.status === null) return { kind: "in_progress" };
  return { kind: "replay", status: row.status, response: row.response };
}

export async function storeIdempotency(tenantId: string, key: string, status: number, response: unknown): Promise<void> {
  await trustedPool().query("update public.api_idempotency set status = $3, response = $4 where tenant_id = $1 and idem_key = $2", [tenantId, key, status, JSON.stringify(response)]);
}

export async function releaseIdempotency(tenantId: string, key: string): Promise<void> {
  await trustedPool().query("delete from public.api_idempotency where tenant_id = $1 and idem_key = $2 and status is null", [tenantId, key]);
}

let svc: ReturnType<typeof createClient<Database>> | undefined;
/** Service-role client for stage/commit (commit_import_batch accepts the service role; ADR 0008). Never leaves the server. */
export function ingestClient() {
  svc ??= createClient<Database>(supabaseUrl(), serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  return svc;
}
