// `pnpm payments reconcile` (step 14): READ-ONLY. For every hosted request of the tenant created in the period,
// ask the provider what it says was paid (getStatus) and compare with our ledger, per invoice:
//   missing_in_ledger   the provider reports a payment we have no receipt for (webhook + poll both missed it)
//   unknown_to_provider we hold a gateway receipt for that invoice the provider does not report
// Nothing is stored, queued or applied: a human decides (e.g. waits for the next poll, or opens a task).
import type { PaymentsDeps } from './ports.ts';

export interface ReconcileFinding {
  readonly finding: 'missing_in_ledger' | 'unknown_to_provider' | 'provider_unreachable';
  readonly invoiceId: string;
  readonly providerRef: string | null;
  readonly amountMinor: number | null;
}

export async function reconcile(deps: PaymentsDeps, tenantId: string, from: Date, to: Date): Promise<{ checkedRequests: number; findings: ReconcileFinding[] }> {
  const { db } = deps;
  const r = await db.pool.query<{ id: string; invoice_id: string; payment_account_id: string | null; provider: string; provider_object_id: string }>(
    `select id, invoice_id, payment_account_id, provider, provider_object_id from public.payment_requests
     where tenant_id = $1 and provider_object_id is not null and created_at >= $2 and created_at < $3 order by created_at`,
    [tenantId, from, to],
  );
  const findings: ReconcileFinding[] = [];
  const reported = new Map<string, Map<string, { provider: string; amount: number }>>(); // invoice -> ref -> amount
  const reachable = new Set<string>();
  for (const q of r.rows) {
    const account = q.payment_account_id ? await db.account(q.payment_account_id) : null;
    const gw = account ? await deps.providers.forAccount(account) : undefined;
    if (!gw?.getStatus) continue;
    try {
      const events = await gw.getStatus(q.provider_object_id);
      reachable.add(q.invoice_id);
      const m = reported.get(q.invoice_id) ?? new Map<string, { provider: string; amount: number }>();
      for (const e of events) if (e.type === 'payment_confirmed') m.set(e.providerRef, { provider: q.provider, amount: e.amountMinor });
      reported.set(q.invoice_id, m);
    } catch {
      findings.push({ finding: 'provider_unreachable', invoiceId: q.invoice_id, providerRef: null, amountMinor: null });
    }
  }
  for (const invoiceId of reachable) {
    const providerRefs = reported.get(invoiceId) ?? new Map();
    const ours = await db.pool.query<{ provider_ref: string; amount: string }>(
      `select provider_ref, amount from public.receipts where tenant_id = $1 and invoice_id = $2 and method in ('stripe', 'fake') and source in ('gateway', 'poll')`,
      [tenantId, invoiceId],
    );
    const ledger = new Map(ours.rows.map((x) => [x.provider_ref, Number(x.amount)]));
    for (const [ref, p] of providerRefs) if (!ledger.has(ref)) findings.push({ finding: 'missing_in_ledger', invoiceId, providerRef: ref, amountMinor: p.amount });
    for (const [ref, amount] of ledger) if (!providerRefs.has(ref)) findings.push({ finding: 'unknown_to_provider', invoiceId, providerRef: ref, amountMinor: amount });
  }
  return { checkedRequests: r.rows.length, findings };
}
