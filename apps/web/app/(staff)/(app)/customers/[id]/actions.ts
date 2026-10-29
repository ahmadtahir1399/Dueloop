"use server";

// Consent records (setup-flow review, round 1): WhatsApp needs one before any send (messaging router), and nothing
// in the UI could create it. RLS on customer_consents (insert/update: owner, accountant) is the database check;
// the customer must belong to the active tenant (composite FK). Granting or withdrawing never sends anything.
import { revalidatePath } from "next/cache";
import { type ActionState, dbErrorMessage, textField, uuidField } from "@/lib/actions";
import { requireTenant } from "@/lib/session";

const CHANNELS = new Set(["email", "whatsapp"]);

export async function consentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await requireTenant();
  const customer = uuidField(form, "customer");
  const channel = String(form.get("channel"));
  if (!customer || !CHANNELS.has(channel)) return { error: "Invalid request." };
  if (form.get("op") === "withdraw") {
    const { data, error } = await ctx.supabase
      .from("customer_consents")
      .update({ revoked_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenant.id)
      .eq("customer_id", customer)
      .eq("channel", channel)
      .is("revoked_at", null)
      .select("id");
    if (error) return { error: dbErrorMessage(error) };
    if (!data?.length) return { error: "There is no active consent to withdraw." };
    revalidatePath(`/customers/${customer}`);
    return { ok: true, message: "Withdrawn. No more reminders on this channel." };
  }
  const source = textField(form, "source", 200).trim();
  if (source.length < 3) return { error: "Say how the customer agreed (for example: signed order form, 2 March)." };
  const { error } = await ctx.supabase
    .from("customer_consents")
    .insert({ tenant_id: ctx.tenant.id, customer_id: customer, channel, granted_at: new Date().toISOString(), source });
  if (error?.code === "23505") return { error: "This customer already has an active consent for that channel." };
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath(`/customers/${customer}`);
  return { ok: true, message: "Recorded." };
}
