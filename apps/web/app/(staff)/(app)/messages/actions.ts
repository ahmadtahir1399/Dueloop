"use server";

// Reconciling a message in an unknown state (rule 17): a human checked with the provider and records what really
// happened. Same function as `pnpm messages resolve`. "Not sent" lets decide() retry the step under the SAME key.
import { revalidatePath } from "next/cache";
import { type ActionState, uuidField } from "@/lib/actions";
import { requireTenant } from "@/lib/session";
import { reconcileUnknown } from "@/lib/trusted/ops";

export async function reconcile(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const id = uuidField(form, "message");
  const as = form.get("as");
  if (!id || (as !== "sent" && as !== "not_sent")) return { error: "Invalid request." };
  if (form.get("checked") !== "1") return { error: "Confirm that you checked with the provider first." };
  const r = await reconcileUnknown(ctx, id, as);
  if (!r.ok) return { error: r.reason };
  revalidatePath("/messages");
  return { ok: true, message: as === "sent" ? "Recorded as sent." : "Recorded as not sent. The reminder may be tried again under the same key." };
}
