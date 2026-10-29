"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, textField, uuidField } from "@/lib/actions";
import { requireTenant } from "@/lib/session";
import { resumeReminders } from "@/lib/trusted/ops";

/** Cancels a promise through cancel_promise (owner/accountant, checked in the database; ADR 0022). */
export async function cancelPromise(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const id = uuidField(form, "promise");
  const note = textField(form, "note", 500).trim();
  if (!id) return { error: "Invalid request." };
  if (note.length < 3) return { error: "Give a short reason." };
  const { error } = await ctx.supabase.rpc("cancel_promise", { p_promise_id: id, p_note: note });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/invoices");
  return { ok: true, message: "Promise cancelled. Reminders follow the policy again." };
}

/** Resumes a parked invoice (owner/accountant, checked in the database; lib/trusted/ops.ts resumeReminders). */
export async function resumeInvoice(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const id = uuidField(form, "invoice");
  if (!id) return { error: "Invalid request." };
  const r = await resumeReminders(ctx, id);
  if (!r.ok) return { error: r.reason };
  revalidatePath(`/invoices/${id}`);
  return { ok: true, message: "Resumed. The next reminder is checked again by the usual rules." };
}
