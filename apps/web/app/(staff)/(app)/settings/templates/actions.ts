"use server";

// Template edits go through RLS (owner/accountant W, ADR 0012) plus the 0020 trigger: a WhatsApp body edit sets
// provider_status 'needs_resubmission' (the router then refuses to send it); only an owner sets it back through
// set_template_provider_status. A template that does not render (unknown/missing variables) is refused here too.
import { revalidatePath } from "next/cache";
import { dbErrorMessage, textField, uuidField } from "@/lib/actions";
import { standardTemplateRows } from "@/lib/default-templates";
import { requireTenant } from "@/lib/session";
import { previewTemplate, type TemplatePreview } from "@/lib/template-preview";

export interface TemplateState {
  error?: string;
  message?: string;
  preview?: TemplatePreview;
  draft?: { subject: string; body: string };
}

/** Adds any missing standard email templates; existing ones (and their edits) are never overwritten. */
export async function addStandardTemplatesAction(): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const ctx = await requireTenant();
  const { error } = await ctx.supabase
    .from("templates")
    .upsert(standardTemplateRows(ctx.tenant.id), { onConflict: "tenant_id,template_key,channel,locale", ignoreDuplicates: true });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/settings/templates");
  return { ok: true, message: "Added. Read them and change the wording if you like." };
}

export async function templateAction(_prev: TemplateState, form: FormData): Promise<TemplateState> {
  const ctx = await requireTenant();
  const id = uuidField(form, "template");
  if (!id) return { error: "Invalid request." };
  const { data: t } = await ctx.supabase.from("templates").select("id, channel, locale, subject").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
  if (!t) return { error: "Not found." };
  const op = form.get("op");
  if (op === "approve") {
    const { error } = await ctx.supabase.rpc("set_template_provider_status", { p_tenant: ctx.tenant.id, p_template: id, p_status: "approved" });
    if (error) return { error: dbErrorMessage(error) };
    revalidatePath("/settings/templates");
    return { message: "Marked as approved by the provider." };
  }
  const subject = t.subject === null ? null : textField(form, "subject", 200);
  const body = textField(form, "body", 5000);
  const draft = { subject: subject ?? "", body };
  const preview = previewTemplate({ channel: t.channel, locale: t.locale, subject, body });
  if (op === "preview") return { draft, preview };
  if (!preview.body.ok || (preview.subject && !preview.subject.ok)) return { draft, preview, error: "The template does not render; fix the variables first." };
  const { error } = await ctx.supabase.from("templates").update({ body, ...(subject === null ? {} : { subject }) }).eq("tenant_id", ctx.tenant.id).eq("id", id);
  if (error) return { draft, preview, error: dbErrorMessage(error) };
  revalidatePath("/settings/templates");
  return {
    preview,
    message: t.channel === "whatsapp" ? "Saved. This WhatsApp template must be submitted to Meta again; it will not be sent until an owner marks it approved." : "Saved.",
  };
}
