// Manual payment recording (step 5): a human with the right role enters amount + date + bank reference. The
// text is parsed by code (ingest's parsers, the currency exponent); the plan is printed before anything is
// written; the same bank reference can never count twice (receipts unique key), on any invoice.
import { planPaymentOutcome, type PaymentPlan } from '@dueloop/core';
import { parseAmount, parseDate } from '@dueloop/ingest/parsers';
import { DateTime } from 'luxon';
import type { InvoiceForPayment } from './db.ts';
import { confirmByHuman } from './pipeline.ts';
import type { PaymentsDeps } from './ports.ts';

/** A payment dated up to this many days after "today" in the tenant zone is accepted (bank value dates). */
export const FUTURE_DATE_TOLERANCE_DAYS = 1;
const BANK_REF = /^[\x21-\x7e](?:[\x20-\x7e]{0,118}[\x21-\x7e])?$/;
const CONFIRMING_ROLES = new Set(['owner', 'accountant']);

export interface ManualPaymentInput {
  readonly tenantId: string;
  readonly invoice: string; // number or id
  readonly amount: string;
  readonly date: string; // YYYY-MM-DD, the day the money arrived
  readonly bankRef: string;
  readonly user: string; // id or email of the confirming member
  readonly note?: string;
  readonly decimal?: '.' | ',';
  /** Proof confirmation (step 13f): source 'proof'. With no bank ref at all, the ref is `proof:<proof id>`. */
  readonly proofId?: string;
}

export type ManualPlan =
  | { readonly ok: false; readonly refusal: string }
  | { readonly ok: true; readonly invoice: InvoiceForPayment; readonly userId: string; readonly amountMinor: number; readonly paidAt: Date; readonly bankRef: string; readonly plan: PaymentPlan; readonly proofId: string | null };

export async function planManualPayment(deps: PaymentsDeps, i: ManualPaymentInput): Promise<ManualPlan> {
  const { db } = deps;
  const member = await db.member(i.tenantId, i.user);
  if (!member) return { ok: false, refusal: 'unknown user for this tenant' };
  if (!CONFIRMING_ROLES.has(member.role)) return { ok: false, refusal: `a ${member.role} cannot confirm payments (owner or accountant only)` };

  const invoiceId = await db.invoiceIdByRef(i.tenantId, i.invoice);
  const inv = invoiceId ? await db.invoice(i.tenantId, invoiceId) : null;
  if (!inv) return { ok: false, refusal: 'invoice not found' };

  const amount = parseAmount(i.amount, i.decimal ?? '.', (code) => code ?? inv.currency);
  if (!amount.ok) return { ok: false, refusal: amount.issue.message };
  if (amount.currencyInCell !== null && amount.currencyInCell !== inv.currency) return { ok: false, refusal: `wrong currency: the invoice is in ${inv.currency}` };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date.trim())) return { ok: false, refusal: 'date must be YYYY-MM-DD' };
  const d = parseDate(i.date, 'YMD');
  if (!d.ok) return { ok: false, refusal: d.issue.message };
  const paid = DateTime.fromISO(d.iso, { zone: inv.timezone }).startOf('day');
  const today = DateTime.fromJSDate(deps.clock.now(), { zone: inv.timezone }).startOf('day');
  if (paid > today.plus({ days: FUTURE_DATE_TOLERANCE_DAYS })) return { ok: false, refusal: `date is in the future (more than ${FUTURE_DATE_TOLERANCE_DAYS} day ahead)` };

  const bankRef = i.bankRef.trim() === '' && i.proofId ? `proof:${i.proofId}` : i.bankRef.trim();
  if (!BANK_REF.test(bankRef)) return { ok: false, refusal: 'bank reference is required (printable text, at most 120 characters)' };
  const prior = await db.receiptByRef(i.tenantId, 'bank_transfer', bankRef);
  if (prior) return { ok: false, refusal: prior.invoiceId === inv.id ? 'this bank reference is already recorded for this invoice' : 'this bank reference is already recorded for another invoice' };

  const plan = planPaymentOutcome({
    invoice: { status: inv.status, balanceMinor: inv.balanceMinor, currency: inv.currency },
    receipt: { amountMinor: amount.minor, currency: inv.currency },
    promise: inv.promisedOn ? { promisedOn: inv.promisedOn } : null,
    paidAt: paid.toJSDate(),
    timezone: inv.timezone,
    graceDays: inv.graceDays,
  });
  if (plan.rejected) return { ok: false, refusal: plan.rejected };
  return { ok: true, invoice: inv, userId: member.userId, amountMinor: amount.minor, paidAt: paid.toJSDate(), bankRef, plan, proofId: i.proofId ?? null };
}

export async function recordManualPayment(deps: PaymentsDeps, p: Extract<ManualPlan, { ok: true }>, note: string | null): Promise<{ outcome: 'applied' | 'duplicate'; receiptId: string; plan: PaymentPlan }> {
  return confirmByHuman(deps, {
    tenantId: p.invoice.tenantId,
    invoiceId: p.invoice.id,
    amountMinor: p.amountMinor,
    currency: p.invoice.currency,
    paidAt: p.paidAt,
    bankRef: p.bankRef,
    userId: p.userId,
    source: p.proofId ? 'proof' : 'manual',
    proofId: p.proofId,
    note,
  });
}
