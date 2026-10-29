// Staff actions that run through the EXISTING trusted pipelines (rule 40): manual payments, proof decisions,
// unknown-message reconciliation, proof file viewing. These are the same functions the CLIs call
// (`pnpm payments record`, `pnpm proofs confirm|reject|show`, `pnpm messages resolve`), built by the same
// composition root (@dueloop/worker/runtime), so a button can never do more than the CLI.
//
// Every entry point takes the TenantContext from requireTenant() (verified user, tenant from memberships):
// 1. the target row is read under RLS with the USER's client and must belong to the active tenant (IDOR guard);
// 2. the role is checked in the database for the verified user id (assert_member_role), and apply_payment
//    re-checks it inside its own transaction;
// 3. only then does the pipeline run on the trusted pool, with that user id as the actor.
import "server-only";
import { can } from "@dueloop/authz";
import { planManualPayment, recordManualPayment, type ManualPlan } from "@dueloop/payments";
import { confirmProof, planProofConfirmation, rejectProof } from "@dueloop/proofs";
import { reconcileMessage, WorkerDb } from "@dueloop/worker";
import { buildDeps, buildPaymentsDeps, buildProofsDeps } from "@dueloop/worker/runtime";
import { NOT_RESUMABLE } from "@/lib/parked";
import type { TenantContext } from "@/lib/session";
import { trustedPool } from "./db";
import { serviceRoleKey, supabaseUrl, trustedDbUrl } from "./env";

const clock = { now: () => new Date() };

function env() {
  // The composition root reads the same variables as the worker; the database is the trusted pool's.
  return { ...process.env, WORKER_DATABASE_URL: trustedDbUrl(), SUPABASE_URL: supabaseUrl(), SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey() };
}
/** The same environment the worker and CLIs read, for the shared composition root. */
export const opsEnv = env;

function workerDb() {
  return new WorkerDb(trustedPool());
}

export type OpsResult<T> = { ok: true; value: T } | { ok: false; reason: string };

async function assertRole(ctx: TenantContext, roles: string[]): Promise<boolean> {
  const r = await trustedPool().query<{ ok: boolean }>("select private.member_has_role($1, $2, $3) as ok", [ctx.tenant.id, ctx.userId, roles]);
  return r.rows[0]?.ok === true;
}

// ---- manual payments --------------------------------------------------------------------------------------

export interface PaymentInput {
  invoiceId: string;
  amount: string;
  date: string;
  bankRef: string;
  decimal: "." | ",";
  note: string | null;
}

export interface PlanSummary {
  invoiceNumber: string;
  currency: string;
  balance: string;
  amount: string;
  applied: string;
  credit: string;
  transition: string | null;
  promise: string | null;
  receipt: boolean;
  /** Fingerprint of the numbers shown: confirm only applies a plan that still has the same numbers. */
  fingerprint: string;
  warnings: string[];
}

function summarise(p: Extract<ManualPlan, { ok: true }>, warnings: readonly string[] = []): PlanSummary {
  const s = {
    invoiceNumber: p.invoice.number,
    currency: p.invoice.currency,
    balance: String(p.invoice.balanceMinor),
    amount: String(p.amountMinor),
    applied: String(p.plan.applied),
    credit: String(p.plan.credit),
    transition: p.plan.transition?.to ?? null,
    promise: p.plan.promiseOutcome ?? null,
    receipt: p.plan.sendReceipt,
    warnings: [...warnings],
  };
  return { ...s, fingerprint: [s.balance, s.amount, s.applied, s.credit, s.transition, p.invoice.status, p.bankRef].join("|") };
}

async function invoiceInTenant(ctx: TenantContext, invoiceId: string): Promise<boolean> {
  const r = await ctx.supabase.from("invoices").select("id").eq("tenant_id", ctx.tenant.id).eq("id", invoiceId).maybeSingle();
  return !r.error && r.data !== null;
}

export async function planPayment(ctx: TenantContext, i: PaymentInput): Promise<OpsResult<PlanSummary>> {
  if (!can(ctx.role, "payments.record")) return { ok: false, reason: "Only an owner or accountant can record payments." };
  if (!(await invoiceInTenant(ctx, i.invoiceId))) return { ok: false, reason: "Invoice not found." };
  if (!(await assertRole(ctx, ["owner", "accountant"]))) return { ok: false, reason: "Only an owner or accountant can record payments." };
  const deps = buildPaymentsDeps(env(), workerDb(), clock);
  const p = await planManualPayment(deps, { tenantId: ctx.tenant.id, invoice: i.invoiceId, amount: i.amount, date: i.date, bankRef: i.bankRef, user: ctx.userId, decimal: i.decimal });
  return p.ok ? { ok: true, value: summarise(p) } : { ok: false, reason: p.refusal };
}

/** Re-plans with fresh data and records only if the numbers still match what the human saw (rule 16 spirit). */
export async function recordPayment(ctx: TenantContext, i: PaymentInput, fingerprint: string): Promise<OpsResult<{ receiptId: string } | { changed: PlanSummary }>> {
  if (!can(ctx.role, "payments.record")) return { ok: false, reason: "Only an owner or accountant can record payments." };
  if (!(await invoiceInTenant(ctx, i.invoiceId))) return { ok: false, reason: "Invoice not found." };
  if (!(await assertRole(ctx, ["owner", "accountant"]))) return { ok: false, reason: "Only an owner or accountant can record payments." };
  const deps = buildPaymentsDeps(env(), workerDb(), clock);
  const p = await planManualPayment(deps, { tenantId: ctx.tenant.id, invoice: i.invoiceId, amount: i.amount, date: i.date, bankRef: i.bankRef, user: ctx.userId, decimal: i.decimal });
  if (!p.ok) return { ok: false, reason: p.refusal };
  const s = summarise(p);
  if (s.fingerprint !== fingerprint) return { ok: true, value: { changed: s } };
  const r = await recordManualPayment(deps, p, i.note);
  return r.outcome === "applied" ? { ok: true, value: { receiptId: r.receiptId } } : { ok: false, reason: "This bank reference is already recorded." };
}

// ---- proofs --------------------------------------------------------------------------------------------------

async function proofInTenant(ctx: TenantContext, proofId: string) {
  const r = await ctx.supabase.from("payment_proofs").select("id, storage_path, mime, status").eq("tenant_id", ctx.tenant.id).eq("id", proofId).maybeSingle();
  return r.error ? null : r.data;
}

export async function planProof(ctx: TenantContext, proofId: string, i: Omit<PaymentInput, "invoiceId" | "note">): Promise<OpsResult<PlanSummary>> {
  if (!can(ctx.role, "proofs.decide")) return { ok: false, reason: "Only an owner or accountant can decide on proofs." };
  if (!(await proofInTenant(ctx, proofId))) return { ok: false, reason: "Proof not found." };
  if (!(await assertRole(ctx, ["owner", "accountant"]))) return { ok: false, reason: "Only an owner or accountant can decide on proofs." };
  const db = workerDb();
  const proofs = buildProofsDeps(env(), db, clock);
  const pay = buildPaymentsDeps(env(), db, clock);
  const plan = await planProofConfirmation(proofs.db, pay, { proofId, amount: i.amount, date: i.date, bankRef: i.bankRef, user: ctx.userId, decimal: i.decimal });
  return plan.ok ? { ok: true, value: summarise(plan.plan, plan.warnings) } : { ok: false, reason: plan.refusal };
}

export async function confirmProofAction(ctx: TenantContext, proofId: string, i: Omit<PaymentInput, "invoiceId">, fingerprint: string): Promise<OpsResult<{ receiptId: string } | { changed: PlanSummary }>> {
  if (!can(ctx.role, "proofs.decide")) return { ok: false, reason: "Only an owner or accountant can decide on proofs." };
  if (!(await proofInTenant(ctx, proofId))) return { ok: false, reason: "Proof not found." };
  if (!(await assertRole(ctx, ["owner", "accountant"]))) return { ok: false, reason: "Only an owner or accountant can decide on proofs." };
  const db = workerDb();
  const proofs = buildProofsDeps(env(), db, clock);
  const pay = buildPaymentsDeps(env(), db, clock);
  const plan = await planProofConfirmation(proofs.db, pay, { proofId, amount: i.amount, date: i.date, bankRef: i.bankRef, user: ctx.userId, decimal: i.decimal });
  if (!plan.ok) return { ok: false, reason: plan.refusal };
  const s = summarise(plan.plan, plan.warnings);
  if (s.fingerprint !== fingerprint) return { ok: true, value: { changed: s } };
  const r = await confirmProof(proofs.db, pay, proofId, plan, i.note);
  return r.outcome === "applied" ? { ok: true, value: { receiptId: r.receiptId } } : { ok: false, reason: "This bank reference is already recorded." };
}

export async function rejectProofAction(ctx: TenantContext, proofId: string, reason: string): Promise<OpsResult<null>> {
  if (!can(ctx.role, "proofs.decide")) return { ok: false, reason: "Only an owner or accountant can decide on proofs." };
  if (!(await proofInTenant(ctx, proofId))) return { ok: false, reason: "Proof not found." };
  if (!(await assertRole(ctx, ["owner", "accountant"]))) return { ok: false, reason: "Only an owner or accountant can decide on proofs." };
  const db = workerDb();
  const r = await rejectProof(buildProofsDeps(env(), db, clock).db, buildPaymentsDeps(env(), db, clock), proofId, ctx.userId, reason);
  return r.ok ? { ok: true, value: null } : { ok: false, reason: r.refusal };
}

/** A short-lived signed URL for one proof file (same 300 s as `pnpm proofs show`). Never cached, never logged. */
export async function proofViewUrl(ctx: TenantContext, proofId: string): Promise<OpsResult<{ url: string; mime: string }>> {
  if (!can(ctx.role, "proofs.view")) return { ok: false, reason: "Not allowed." };
  const p = await proofInTenant(ctx, proofId);
  if (!p) return { ok: false, reason: "Proof not found." };
  const proofs = buildProofsDeps(env(), workerDb(), clock);
  try {
    const url = await proofs.store.signedUrl(p.storage_path, 300);
    return { ok: true, value: { url, mime: p.mime } };
  } catch {
    return { ok: false, reason: "The file is not available." }; // missing object: a 404, never a stack trace
  }
}

// ---- unknown messages --------------------------------------------------------------------------------------

export async function reconcileUnknown(ctx: TenantContext, messageId: string, as: "sent" | "not_sent"): Promise<OpsResult<null>> {
  if (!can(ctx.role, "messages.reconcile")) return { ok: false, reason: "Only an owner or accountant can reconcile messages." };
  const m = await ctx.supabase.from("messages").select("id, send_state").eq("tenant_id", ctx.tenant.id).eq("id", messageId).maybeSingle();
  if (m.error || !m.data) return { ok: false, reason: "Message not found." };
  if (!(await assertRole(ctx, ["owner", "accountant"]))) return { ok: false, reason: "Only an owner or accountant can reconcile messages." };
  const ok = await reconcileMessage(buildDeps(env(), workerDb(), clock), messageId, as);
  return ok ? { ok: true, value: null } : { ok: false, reason: "This message is no longer in the unknown state." };
}

// ---- resume a parked invoice ----------------------------------------------------------------------------------

/**
 * "Resume reminders" (the same database function as `pnpm messages unpark`). It only makes the invoice due again:
 * the worker still runs decide() with fresh context and every send gate (rule 40). Refused while any message for
 * the invoice is in the unknown state (rule 17).
 */
export async function resumeReminders(ctx: TenantContext, invoiceId: string): Promise<OpsResult<null>> {
  const { data: inv } = await ctx.supabase.from("invoices").select("id, parked_reason").eq("tenant_id", ctx.tenant.id).eq("id", invoiceId).maybeSingle();
  if (!inv) return { ok: false, reason: "Not found." };
  if (!(await assertRole(ctx, ["owner", "accountant"]))) return { ok: false, reason: "Only an owner or accountant can resume reminders." };
  if (!inv.parked_reason) return { ok: false, reason: "Reminders for this invoice are not on hold." };
  if (NOT_RESUMABLE.has(inv.parked_reason)) return { ok: false, reason: "Resolve this on the Unknown sends or Approvals page instead." };
  const client = await trustedPool().connect();
  try {
    await client.query("begin");
    // Refused while any message of the invoice is unknown OR still pending (in flight / ambiguous): rule 17.
    // No FOR UPDATE here: unpark_invoice updates this very row, and a row the same statement modified is skipped by
    // the lock; its own UPDATE takes the row lock.
    const r = await client.query<{ ok: boolean; reason: string }>(
      `select i.parked_reason as reason, private.unpark_invoice(i.id, now()) as ok from public.invoices i
       where i.tenant_id = $1 and i.id = $2 and i.parked_reason is not null and not (i.parked_reason = any($3::text[]))
         and not exists (select 1 from public.message_invoices mi join public.messages m on m.tenant_id = mi.tenant_id and m.id = mi.message_id
                         where mi.tenant_id = i.tenant_id and mi.invoice_id = i.id and m.send_state in ('unknown', 'pending'))`,
      [ctx.tenant.id, invoiceId, [...NOT_RESUMABLE]],
    );
    if (r.rows[0]?.ok !== true) {
      await client.query("rollback");
      return { ok: false, reason: "This invoice has a message that may have been sent. Check it on the Unknown sends page first." };
    }
    // After a dead letter the step's message is in 'retry' (provably NOT sent) with attempt = maxAttempts, so the
    // next pass would dead-letter it again at once. Resuming gives it a fresh set of attempts (rule 17 holds:
    // only 'retry' rows are touched, never 'unknown' or 'pending').
    if (r.rows[0].reason === "dead_letter") {
      await client.query(
        `update public.messages m set attempt = 0 from public.message_invoices mi
         where mi.tenant_id = m.tenant_id and mi.message_id = m.id and mi.tenant_id = $1 and mi.invoice_id = $2 and m.send_state = 'retry'`,
        [ctx.tenant.id, invoiceId],
      );
    }
    await client.query("commit");
    return { ok: true, value: null };
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
