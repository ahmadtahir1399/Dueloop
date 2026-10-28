"use server";

// Approvals: every action calls the EXISTING RPCs as the signed-in user (decide_approval, edit_approval), which
// check role and tenant inside the database (ADR 0012). An approval authorises one idempotency key; the worker
// still runs decide() and the send protocol before anything goes out (rule 16).
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, textField, uuidField } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

export async function decideApproval(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const id = uuidField(form, "approval");
  const decision = form.get("decision");
  if (!id || (decision !== "approve" && decision !== "reject")) return { error: "Invalid request." };
  const note = textField(form, "note", 500).trim();
  if (decision === "reject" && note.length < 3) return { error: "Say why you are rejecting it (at least 3 characters)." };
  const { error } = await ctx.supabase.rpc("decide_approval", { p_approval_id: id, p_decision: decision, ...(note ? { p_note: note } : {}) });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/approvals");
  return { ok: true, message: decision === "approve" ? "Approved. The worker sends it on its next pass." : "Rejected." };
}

export async function editApproval(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const id = uuidField(form, "approval");
  if (!id) return { error: "Invalid request." };
  const subject = textField(form, "subject", 200);
  const body = textField(form, "body", 5000);
  if (body.trim().length === 0) return { error: "The message cannot be empty." };
  const { error } = await ctx.supabase.rpc("edit_approval", { p_approval_id: id, p_subject: subject, p_body: body });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/approvals");
  return { ok: true, message: "Saved. The footer is added when it is sent." };
}

/**
 * Bulk approve with an explicit count: the form carries the ids AND the count the human confirmed. A mismatch
 * (the selection changed) approves nothing. Each id goes through decide_approval on its own.
 */
export async function bulkApprove(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const ids = form.getAll("approval").filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v));
  const confirmed = Number(form.get("confirm_count"));
  if (ids.length === 0) return { error: "Select at least one approval." };
  if (ids.length > 200) return { error: "Approve at most 200 at a time." };
  if (!Number.isSafeInteger(confirmed) || confirmed !== ids.length) {
    return { error: `You confirmed ${Number.isSafeInteger(confirmed) ? confirmed : 0} but ${ids.length} are selected. Nothing was approved.` };
  }
  let approved = 0;
  const failed: string[] = [];
  for (const id of ids) {
    const { error } = await ctx.supabase.rpc("decide_approval", { p_approval_id: id, p_decision: "approve" });
    if (error) failed.push(dbErrorMessage(error));
    else approved++;
  }
  revalidatePath("/approvals");
  return failed.length
    ? { ok: approved > 0, error: `${approved} approved, ${failed.length} not approved (${[...new Set(failed)].join("; ")}).` }
    : { ok: true, message: `${approved} approved. The worker sends them on its next pass.` };
}
