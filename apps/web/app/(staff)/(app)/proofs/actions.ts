"use server";

// Proof decisions through the prompt 5 workflow (planProofConfirmation / confirmProof / rejectProof), the same
// functions as `pnpm proofs confirm|reject`. The amount, date and bank reference are ALWAYS typed by the human.
import { revalidatePath } from "next/cache";
import { textField, uuidField } from "@/lib/actions";
import { requireTenant } from "@/lib/session";
import { confirmProofAction, planProof, rejectProofAction, type PlanSummary } from "@/lib/trusted/ops";

export interface PlanState {
  error?: string;
  message?: string;
  plan?: PlanSummary;
}

function input(form: FormData) {
  const decimal = form.get("decimal") === "," ? ("," as const) : (".");
  return {
    amount: textField(form, "amount", 40).trim(),
    date: textField(form, "date", 10).trim(),
    bankRef: form.get("no_bank_ref") === "1" ? "" : textField(form, "bank_ref", 120),
    decimal: decimal as "." | ",",
    note: textField(form, "note", 500).trim() || null,
  };
}

export async function proofDecision(_prev: PlanState, form: FormData): Promise<PlanState> {
  const ctx = await requireTenant();
  const id = uuidField(form, "proof");
  if (!id) return { error: "Invalid request." };
  const op = form.get("op");
  if (op === "reject") {
    const r = await rejectProofAction(ctx, id, textField(form, "reason", 500));
    if (!r.ok) return { error: r.reason };
    revalidatePath("/proofs");
    return { message: "Rejected. Reminders for the invoice resume." };
  }
  const i = input(form);
  if (form.get("no_bank_ref") !== "1" && i.bankRef.trim() === "") return { error: "Enter the bank reference from your statement, or tick 'no bank reference'." };
  if (op === "preview") {
    const p = await planProof(ctx, id, i);
    return p.ok ? { plan: p.value } : { error: p.reason };
  }
  if (op === "confirm") {
    const r = await confirmProofAction(ctx, id, i, textField(form, "fingerprint", 400));
    if (!r.ok) return { error: r.reason };
    if ("changed" in r.value) return { plan: r.value.changed, error: "The numbers changed since the preview. Check the new plan and confirm again." };
    revalidatePath("/proofs");
    return { message: "Confirmed. The payment is recorded." };
  }
  return { error: "Invalid request." };
}
