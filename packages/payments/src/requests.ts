// Payment requests (links / bank instructions): one active per (invoice, provider), reused while it still
// matches the balance and stays valid, replaced when it does not (issue F). Provider objects are switched off
// after our rows retire them (sweep), so a stale link stops taking money.
import { randomUUID } from 'node:crypto';
import type { RequestRow, Scope } from './db.ts';
import type { PaymentsDeps } from './ports.ts';

const FINAL = new Set(['paid', 'written_off', 'cancelled']);

export type RequestResult = { readonly request: RequestRow; readonly reused: boolean } | { readonly request: null; readonly reason: 'no_account' | 'no_gateway' | 'final_invoice' | 'nothing_due' | 'invoice_missing' };

function stillValid(r: RequestRow, balance: number, currency: string, now: Date, minRemainingMs: number): boolean {
  if (r.amountMinor !== balance || r.currency !== currency) return false;
  return r.expiresAt === null || r.expiresAt.getTime() - now.getTime() >= minRemainingMs;
}

async function retire(deps: PaymentsDeps, r: RequestRow, reason: string): Promise<void> {
  await deps.db.deactivateRequest(r.id, reason, deps.clock.now());
  await syncOne(deps, r);
}

/** Switch one retired request off at the provider; failures are left for the next sweep. */
async function syncOne(deps: PaymentsDeps, r: RequestRow): Promise<boolean> {
  if (!r.providerObjectId) return true;
  const account = r.accountId ? await deps.db.account(r.accountId) : null;
  const gw = account ? await deps.providers.forAccount(account) : undefined;
  if (!gw) return false; // cannot reach the provider now: the sweep tries again
  try {
    if (gw.deactivate) await gw.deactivate(r.providerObjectId);
    await deps.db.markProviderDeactivated(r.id, deps.clock.now());
    return true;
  } catch {
    deps.logger.warn('payment_request_deactivate_failed', { tenantId: r.tenantId, invoiceId: r.invoiceId });
    return false;
  }
}

/**
 * The request a reminder should carry for this invoice, created at most once per (invoice, balance, generation).
 * Idempotent: the provider gets the same idempotency key on a retry, and a concurrent creator loses the
 * one-active unique index and reads the winner's row.
 */
export async function createRequestFor(deps: PaymentsDeps, tenantId: string, invoiceId: string): Promise<RequestResult> {
  const { db, clock, config } = deps;
  const inv = await db.invoice(tenantId, invoiceId);
  if (!inv) return { request: null, reason: 'invoice_missing' };
  const accountRow = await db.accountFor(tenantId);
  if (!accountRow) return { request: null, reason: 'no_account' };
  const account = { ...accountRow, tenantId };
  const gw = await deps.providers.forAccount(account);
  if (!gw) return { request: null, reason: 'no_gateway' };

  // Anything our rows already retired for this invoice is switched off first (a replaced link stops taking money).
  await sweepRequests(deps, { tenantId, invoiceId }, 10);
  const active = await db.activeRequest(tenantId, invoiceId, account.provider);
  if (FINAL.has(inv.status)) {
    if (active) await retire(deps, active, 'invoice_final');
    return { request: null, reason: 'final_invoice' };
  }
  if (inv.balanceMinor <= 0) return { request: null, reason: 'nothing_due' };

  const now = clock.now();
  if (active) {
    if (stillValid(active, inv.balanceMinor, inv.currency, now, config.linkMinRemainingHours * 3_600_000)) return { request: active, reused: true };
    await retire(deps, active, active.amountMinor !== inv.balanceMinor ? 'balance_changed' : 'expiring');
  }

  const generation = await db.requestGeneration(tenantId, invoiceId, account.provider);
  const idempotencyKey = `payreq:${invoiceId}:${account.provider}:${inv.balanceMinor}${inv.currency}:g${generation}`;
  const created = await gw.createPaymentRequest({ invoiceId, amountMinor: inv.balanceMinor, currency: inv.currency, reference: inv.referenceCode, idempotencyKey });
  try {
    const request = await db.insertRequest({
      id: randomUUID(),
      tenantId,
      invoiceId,
      accountId: account.id,
      provider: account.provider,
      providerObjectId: created.providerObjectId ?? null,
      url: created.url ?? null,
      amountMinor: inv.balanceMinor,
      currency: inv.currency,
      expiresAt: created.expiresAt ?? null,
      createdAt: now,
      idempotencyKey,
    });
    deps.logger.info('payment_request_created', { tenantId, invoiceId, count: inv.balanceMinor });
    return { request, reused: false };
  } catch (e) {
    // Lost the race for the one active request: use the winner's.
    if ((e as { code?: string }).code === '23505') {
      const winner = await db.activeRequest(tenantId, invoiceId, account.provider);
      if (winner) return { request: winner, reused: true };
    }
    throw e;
  }
}

/** Retire every active request of an invoice (it was closed, or a human asked). */
export async function deactivateRequests(deps: PaymentsDeps, tenantId: string, invoiceId: string, reason: string): Promise<number> {
  let n = 0;
  for (const provider of ['stripe', 'fake', 'bank_transfer']) {
    const r = await deps.db.activeRequest(tenantId, invoiceId, provider);
    if (r) {
      await retire(deps, r, reason);
      n++;
    }
  }
  return n;
}

/**
 * The sweep: (1) active requests on invoices that became final some other way are retired; (2) requests our
 * rows retired (apply_payment did it inside the ledger transaction) are switched off at the provider.
 */
export async function sweepRequests(deps: PaymentsDeps, scope: Scope = {}, limit = 100): Promise<{ retired: number; synced: number; failed: number }> {
  let retired = 0;
  for (const r of await deps.db.staleActiveRequests(limit, scope)) {
    if (await deps.db.deactivateRequest(r.id, 'invoice_final', deps.clock.now())) retired++;
  }
  let synced = 0;
  let failed = 0;
  for (const r of await deps.db.requestsToSync(limit, scope)) {
    if (await syncOne(deps, r)) synced++;
    else failed++;
  }
  return { retired, synced, failed };
}
