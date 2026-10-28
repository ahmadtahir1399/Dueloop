"use server";

// Tasks change only through resolve_task / reopen_task (ADR 0022), called as the signed-in user; the database
// checks membership of the task's tenant and records who and why. Nothing here sends a message.
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, textField, uuidField } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

export async function resolveTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const id = uuidField(form, "task");
  const op = form.get("op");
  const note = textField(form, "note", 500).trim();
  if (!id || (op !== "resolve" && op !== "reopen")) return { error: "Invalid request." };
  if (note.length < 3) return { error: "Write a short reason (at least 3 characters)." };
  const { data, error } =
    op === "resolve"
      ? await ctx.supabase.rpc("resolve_task", { p_task_id: id, p_note: note })
      : await ctx.supabase.rpc("reopen_task", { p_task_id: id, p_note: note });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${id}`);
  const text: Record<string, string> = {
    resolved: "Resolved.",
    already_resolved: "It was already resolved.",
    reopened: "Reopened.",
    already_open: "It was already open.",
  };
  return { ok: true, message: text[String(data)] ?? "Done." };
}
