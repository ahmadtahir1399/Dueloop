// Approval previews with the PRODUCTION renderer (worker buildContent: same template pick, variables, payment
// block and footer as a real send). Read-only: no payment request is created for a preview (the link slot shows
// a placeholder), nothing is claimed, nothing is written.
import "server-only";
import { appendFooter } from "@dueloop/messaging";
import { buildContent, loadContext, WorkerDb } from "@dueloop/worker";
import type { TenantContext } from "@/lib/session";
import { trustedPool } from "./db";

export interface Preview {
  ok: boolean;
  subject: string | null;
  body: string;
  reason?: string;
}

/** `approvalIds` must already be known to belong to ctx.tenant (read under RLS by the caller). */
export async function previewApprovals(ctx: TenantContext, approvals: { id: string; invoiceId: string; stepId: string; channel: string; idempotencyKey: string; subjectOverride: string | null; bodyOverride: string | null }[]): Promise<Map<string, Preview>> {
  const db = new WorkerDb(trustedPool());
  const out = new Map<string, Preview>();
  const now = new Date();
  for (const a of approvals.slice(0, 100)) {
    const loaded = await loadContext(db, ctx.tenant.id, a.invoiceId);
    if (!loaded.ok) {
      out.set(a.id, { ok: false, subject: null, body: "", reason: loaded.reason });
      continue;
    }
    const step = loaded.ctx.policy.steps.find((s) => s.id === a.stepId);
    if (!step || (a.channel !== "email" && a.channel !== "whatsapp" && a.channel !== "sms")) {
      out.set(a.id, { ok: false, subject: null, body: "", reason: "step_missing" });
      continue;
    }
    const c = buildContent(loaded.ctx, a.idempotencyKey, step.templateKey, a.channel, now, { subject: a.subjectOverride, body: a.bodyOverride }, null);
    out.set(a.id, c.ok ? { ok: true, subject: c.subject, body: c.body } : { ok: false, subject: null, body: "", reason: c.reason });
  }
  return out;
}

/** What an edited body will look like: the edit, then the footer the sender always appends (never editable). */
export function previewEdit(body: string, channel: "email" | "whatsapp" | "sms", locale: string): string {
  return appendFooter(body, channel, locale);
}
