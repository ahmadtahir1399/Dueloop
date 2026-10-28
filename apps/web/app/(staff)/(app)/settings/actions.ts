"use server";

// Tenant kill switch through set_outbound_paused (owner only, checked in the database; ADR 0012). Pausing takes
// effect immediately: the worker checks it right before every send (rule 18). Resuming needs a typed confirmation.
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

export async function setPaused(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const want = form.get("paused");
  if (want !== "true" && want !== "false") return { error: "Invalid request." };
  const confirm = String(form.get("confirm") ?? "").trim().toUpperCase();
  const expected = want === "true" ? "PAUSE" : "RESUME";
  if (confirm !== expected) return { error: `Type ${expected} to confirm.` };
  const { error } = await ctx.supabase.rpc("set_outbound_paused", { p_tenant_id: ctx.tenant.id, p_paused: want === "true" });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: want === "true" ? "Sending is paused. Nothing will be sent until you resume." : "Sending is resumed." };
}
