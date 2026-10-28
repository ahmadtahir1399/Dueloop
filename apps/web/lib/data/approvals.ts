import "server-only";
import type { TenantContext } from "@/lib/session";
import { previewApprovals, type Preview } from "@/lib/trusted/preview";

export type { Preview };

/** Pending approvals of the active tenant (RLS) plus a rendered preview of each (strings only). */
export async function loadPendingApprovals(ctx: TenantContext) {
  const { data, error } = await ctx.supabase
    .from("approvals")
    .select("id, invoice_id, step_id, channel, status, requested_at, idempotency_key, subject_override, body_override, invoices(number, status, customer_id, customers(display_name))")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "pending")
    .order("requested_at")
    .order("id")
    .limit(200);
  if (error) throw new Error("could not load approvals");
  const rows = data ?? [];
  const previews = await previewApprovals(
    ctx,
    rows.map((a) => ({ id: a.id, invoiceId: a.invoice_id, stepId: a.step_id, channel: a.channel, idempotencyKey: a.idempotency_key, subjectOverride: a.subject_override, bodyOverride: a.body_override })),
  );
  return { rows, previews };
}
