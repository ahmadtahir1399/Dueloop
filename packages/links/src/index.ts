import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { encodeToken, OPT_OUT_LINK_TTL_DAYS, PAY_LINK_TTL_DAYS, urlFor, type Purpose } from './token.ts';

export * from './token.ts';

/** sha256 hex of the token: the only form ever stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newToken(rand: (n: number) => Uint8Array = randomBytes): string {
  return encodeToken(rand(32));
}

/** Constant-time comparison of two hex digests of equal length. */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const DAY_MS = 86_400_000;

export interface IssuedLinks {
  readonly payUrl: string | null;
  readonly optOutUrl: string;
}

/**
 * Issues a fresh 'pay' link (when an invoice is given) and a fresh 'opt_out' link for the customer, in one
 * transaction. Tokens exist in plaintext only in the returned URLs (they go into the message and nowhere else);
 * the database keeps sha256. Called by the worker BEFORE the outbox claim: a failure here retries or parks,
 * never leaves a message in an unknown state.
 */
export async function issueLinks(
  pool: pg.Pool,
  i: { tenantId: string; invoiceId: string | null; customerId: string; now: Date; baseUrl: string },
  rand: (n: number) => Uint8Array = randomBytes,
): Promise<IssuedLinks> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const issue = async (purpose: Purpose, invoiceId: string | null, ttlDays: number) => {
      const token = newToken(rand);
      await c.query(
        `insert into public.public_links (tenant_id, purpose, invoice_id, customer_id, token_hash, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [i.tenantId, purpose, invoiceId, i.customerId, hashToken(token), i.now, new Date(i.now.getTime() + ttlDays * DAY_MS)],
      );
      return urlFor(i.baseUrl, purpose, token);
    };
    const payUrl = i.invoiceId ? await issue('pay', i.invoiceId, PAY_LINK_TTL_DAYS) : null;
    const optOutUrl = await issue('opt_out', null, OPT_OUT_LINK_TTL_DAYS);
    await c.query('commit');
    return { payUrl, optOutUrl };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export interface ResolvedLink {
  readonly linkId: string;
  readonly tenantId: string;
  readonly invoiceId: string | null;
  readonly customerId: string;
}

/** Same null for unknown, expired, revoked and wrong-purpose tokens (issue A / rule 39). */
export async function resolveLink(pool: pg.Pool, token: string, purpose: Purpose, now: Date): Promise<ResolvedLink | null> {
  const r = await pool.query<{ link_id: string; tenant_id: string; invoice_id: string | null; customer_id: string }>(
    'select * from private.resolve_public_link($1, $2, $3)',
    [hashToken(token), purpose, now],
  );
  const row = r.rows[0];
  return row ? { linkId: row.link_id, tenantId: row.tenant_id, invoiceId: row.invoice_id, customerId: row.customer_id } : null;
}

/** Counts a POST action on a link (GET never writes). */
export async function markUsed(pool: pg.Pool, linkId: string, now: Date): Promise<void> {
  await pool.query('update public.public_links set uses = uses + 1, last_used_at = $2 where id = $1', [linkId, now]);
}

/** Revokes every active link of an invoice (used when staff want to cut off a forwarded link). */
export async function revokeInvoiceLinks(pool: pg.Pool, tenantId: string, invoiceId: string, now: Date): Promise<number> {
  const r = await pool.query('update public.public_links set revoked_at = $3 where tenant_id = $1 and invoice_id = $2 and revoked_at is null', [tenantId, invoiceId, now]);
  return r.rowCount ?? 0;
}

export { OPT_OUT_LINK_TTL_DAYS, PAY_LINK_TTL_DAYS };
