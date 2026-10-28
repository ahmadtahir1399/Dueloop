// Human decisions on a proof (step 13f). Confirm REQUIRES the human-entered amount, date and bank reference
// (never a default from extraction) and goes through the payment pipeline at step 4 with source 'proof'.
// Reject requires a reason, closes the claim task and lets reminders resume (with one alert).
import { planManualPayment, recordManualPayment, type PaymentsDeps } from '@dueloop/payments';
import type { ProofsDb } from './db.ts';

const DECIDERS = new Set(['owner', 'accountant']);

export type ConfirmPlan =
  | { readonly ok: false; readonly refusal: string }
  | { readonly ok: true; readonly plan: Extract<Awaited<ReturnType<typeof planManualPayment>>, { ok: true }>; readonly warnings: readonly string[] };

export async function planProofConfirmation(
  db: ProofsDb,
  pay: PaymentsDeps,
  i: { proofId: string; amount: string; date: string; bankRef: string; user: string; decimal?: '.' | ',' },
): Promise<ConfirmPlan> {
  const p = await db.get(i.proofId);
  if (!p) return { ok: false, refusal: 'proof not found' };
  if (p.status !== 'pending') return { ok: false, refusal: `proof already ${p.status}` };
  if (!p.invoiceId) return { ok: false, refusal: 'this proof is not linked to one invoice: record it with pnpm payments record on the right invoice' };
  const plan = await planManualPayment(pay, { tenantId: p.tenantId, invoice: p.invoiceId, amount: i.amount, date: i.date, bankRef: i.bankRef, user: i.user, proofId: p.id, ...(i.decimal ? { decimal: i.decimal } : {}) });
  if (!plan.ok) return plan;
  const warnings: string[] = [];
  if (p.duplicateOf) warnings.push(`possible duplicate: the same file was received before as proof ${p.duplicateOf}`);
  const same = await db.sameAmountSameDay(p.tenantId, plan.amountMinor, i.date, plan.invoice.timezone);
  if (same.length) warnings.push(`possible duplicate: ${same.length} receipt(s) with the same amount on the same day already exist`);
  return { ok: true, plan, warnings };
}

export async function confirmProof(db: ProofsDb, pay: PaymentsDeps, proofId: string, c: Extract<ConfirmPlan, { ok: true }>, note: string | null): Promise<{ outcome: 'applied' | 'duplicate'; receiptId: string }> {
  const r = await recordManualPayment(pay, c.plan, note);
  if (r.outcome === 'applied') await db.markConfirmed(proofId, r.receiptId, c.plan.userId, pay.clock.now());
  return { outcome: r.outcome, receiptId: r.receiptId };
}

export async function rejectProof(db: ProofsDb, pay: PaymentsDeps, proofId: string, user: string, reason: string): Promise<{ ok: true } | { ok: false; refusal: string }> {
  if (reason.trim().length < 3) return { ok: false, refusal: 'a reason is required' };
  const p = await db.get(proofId);
  if (!p) return { ok: false, refusal: 'proof not found' };
  const member = await pay.db.member(p.tenantId, user);
  if (!member) return { ok: false, refusal: 'unknown user for this tenant' };
  if (!DECIDERS.has(member.role)) return { ok: false, refusal: `a ${member.role} cannot decide on proofs (owner or accountant only)` };
  const r = await db.markRejected(proofId, member.userId, reason.trim(), pay.clock.now());
  if (!r) return { ok: false, refusal: `proof already ${p.status}` };
  if (r.invoiceId) {
    const inv = await pay.db.invoice(r.tenantId, r.invoiceId);
    try {
      if (await pay.db.firstNotification(r.tenantId, `proof:${proofId}:rejected`, 'proof_rejected', pay.clock.now()))
        await pay.notifier.notify({ tenantId: r.tenantId, dedupeKey: `proof:${proofId}:rejected`, kind: 'proof_rejected', severity: 'info', title: `Proof rejected: reminders resume for invoice ${inv?.number ?? '?'}`, lines: [] });
    } catch {
      pay.logger.warn('notify_failed', { tenantId: r.tenantId, reason: 'proof_rejected' });
    }
  }
  return { ok: true };
}
