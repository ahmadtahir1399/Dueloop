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

/**
 * Adds a WhatsApp template (RLS: owner/accountant). It always starts 'pending' (migration 0024 enforces this in the
 * database); the router sends only 'approved' ones, and only an owner can mark it approved.
 */
export async function newWhatsAppTemplateAction(_prev: { ok?: boolean; error?: string; message?: string }, form: FormData): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const ctx = await requireTenant();
  const key = textField(form, "template_key", 40).trim();
  const tone = String(form.get("tone"));
  const locale = textField(form, "locale", 20).trim() || "en";
  const name = textField(form, "provider_template_name", 512).trim();
  const language = textField(form, "provider_language", 20).trim();
  const body = textField(form, "body", 5000);
  if (!/^[a-z0-9_]{1,40}$/.test(key)) return { error: "The template key uses lowercase letters, digits and _ (for example nudge)." };
  if (!["friendly", "neutral", "firm"].includes(tone)) return { error: "Choose a tone." };
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(locale)) return { error: "The customer language is a code like en or ur-Latn." };
  if (!name || !language) return { error: "Give the template name and language code exactly as Meta shows them." };
  const preview = previewTemplate({ channel: "whatsapp", locale, subject: null, body });
  if (!preview.body.ok) return { error: "The text does not render; fix the variables first." };
  const { error } = await ctx.supabase.from("templates").insert({
    tenant_id: ctx.tenant.id,
    template_key: key,
    channel: "whatsapp",
    locale,
    tone,
    body,
    provider_template_name: name,
    provider_language: language,
  });
  if (error?.code === "23505") return { error: "A WhatsApp template with this key and language already exists; edit it instead." };
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/settings/templates");
  return { ok: true, message: "Added as pending. An owner marks it approved once Meta has approved the same text." };
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
