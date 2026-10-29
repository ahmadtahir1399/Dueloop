// The standard email templates a business starts with: onboarding inserts them right after create_tenant, and
// the Templates page offers to add any that are missing. Wording comes only from DEFAULT_TEMPLATES (the demo seed
// equals it and the banned-word tests run on it). WhatsApp has no default: it needs a provider-approved template.
import { DEFAULT_TEMPLATES } from "@dueloop/messaging";

export interface StandardTemplateRow {
  tenant_id: string;
  template_key: string;
  channel: "email";
  locale: string;
  tone: "friendly" | "neutral" | "firm";
  subject: string | null;
  body: string;
}

const STANDARD = DEFAULT_TEMPLATES.filter((t) => t.channel === "email");

export function standardTemplateRows(tenantId: string): StandardTemplateRow[] {
  return STANDARD.map((t) => ({ tenant_id: tenantId, template_key: t.templateKey, channel: "email", locale: t.locale, tone: t.tone, subject: t.subject, body: t.body }));
}

/** Template keys of the standard set this tenant does not have yet (same key, channel and locale). */
export function missingStandardTemplates(existing: readonly { template_key: string; channel: string; locale: string }[]): string[] {
  return STANDARD.filter((t) => !existing.some((e) => e.template_key === t.templateKey && e.channel === "email" && e.locale === t.locale)).map((t) => t.templateKey);
}
