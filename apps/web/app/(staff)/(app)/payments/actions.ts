"use server";

// Manual payment recording through the prompt 5 pipeline (planManualPayment / recordManualPayment), the same
// functions as `pnpm payments record`. Nothing here trusts an amount it did not parse itself, and confirm re-plans.
import { revalidatePath } from "next/cache";
import type { PlanFormState } from "@/components/payment-plan-form";
import { textField, uuidField } from "@/lib/actions";
import { requireTenant } from "@/lib/session";
import { planPayment, recordPayment } from "@/lib/trusted/ops";

export async function paymentAction(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const ctx = await requireTenant();
  const invoiceId = uuidField(form, "invoice");
  if (!invoiceId) return { error: "Invalid request." };
  const i = {
    invoiceId,
    amount: textField(form, "amount", 40).trim(),
    date: textField(form, "date", 10).trim(),
    bankRef: textField(form, "bank_ref", 120),
    decimal: form.get("decimal") === "," ? ("," as const) : ("." as const),
    note: textField(form, "note", 500).trim() || null,
  };
  const op = form.get("op");
  if (op === "preview") {
    const p = await planPayment(ctx, i);
    return p.ok ? { plan: p.value } : { error: p.reason };
  }
  if (op === "confirm") {
    const r = await recordPayment(ctx, i, textField(form, "fingerprint", 400));
    if (!r.ok) return { error: r.reason };
    if ("changed" in r.value) return { plan: r.value.changed, error: "The numbers changed since the preview. Check the new plan and confirm again." };
    revalidatePath(`/invoices/${invoiceId}`);
    return { message: "Recorded. The invoice balance is updated." };
  }
  return { error: "Invalid request." };
}
