// Polling fallback (issue J/F): requests still active long after creation are asked about directly. What the
// provider says goes through the SAME store -> queue -> pipeline path as a webhook; receipts dedupe on
// (tenant, method, provider_ref), so a webhook and a poll for one payment apply the money once.
import type { Scope } from './db.ts';
import type { PaymentsDeps } from './ports.ts';

/** Provider event ids for polled events carry this prefix (the pipeline records source 'poll'). */
export const POLL_EVENT_PREFIX = 'poll:';

export async function pollPending(deps: PaymentsDeps, scope: Scope = {}, limit = 50): Promise<{ checked: number; stored: number; failed: number }> {
  const { db, clock, config } = deps;
  const now = clock.now();
  const due = await db.pendingRequests(new Date(now.getTime() - config.pollAfterMinutes * 60_000), limit, scope);
  let stored = 0;
  let failed = 0;
  for (const r of due) {
    if (!r.accountId || !r.providerObjectId) continue;
    const account = await db.account(r.accountId);
    const gw = account ? await deps.providers.forAccount(account) : undefined;
    if (!account || !gw?.getStatus) continue;
    try {
      for (const e of await gw.getStatus(r.providerObjectId)) {
        const providerEventId = `${POLL_EVENT_PREFIX}${e.type}:${e.providerRef}`;
        const id = await db.store(account.id, account.provider, { ...e, requestRef: e.requestRef ?? r.providerObjectId, providerEventId }, null, now);
        if (id !== null) stored++;
      }
    } catch {
      failed++;
      deps.logger.warn('payment_poll_failed', { tenantId: r.tenantId, invoiceId: r.invoiceId });
    }
  }
  return { checked: due.length, stored, failed };
}
