// Template preview (issue L) with the PRODUCTION renderer (messaging render: fail-closed on unknown or missing
// variables) and the footer appended exactly as the sender does. Sample values are fixed and obviously fake.
// The wording scan is prompt 3's list, shown as a WARNING (not legal advice).
import { appendFooter, BANNED_WORDING, paymentBlock, render, type RenderResult } from "@dueloop/messaging";

export const SAMPLE_VARS: Record<string, string> = {
  customer_name: "Sample Customer Ltd",
  business_name: "Your Business",
  invoice_number: "INV-0001",
  amount_due: "£1,250.00",
  due_date: "1 March 2026",
  days_overdue: "14",
  reference_code: "REFSAMPL",
  bank_instructions: "Bank: Example Bank, Account 00000000",
  pay_link: "https://pay.example.invalid/p/sample-token",
  payment_block: paymentBlock({ amountDue: "£1,250.00", referenceCode: "REFSAMPL", bankText: "Bank: Example Bank, Account 00000000", link: "https://pay.example.invalid/p/sample-token" }),
  amount_received: "£500.00",
  balance_remaining: "£750.00",
};

export interface TemplatePreview {
  subject: RenderResult | null;
  body: RenderResult;
  /** The body as it would be sent (footer appended; email only). */
  sent: string | null;
  warnings: string[];
}

export function previewTemplate(t: { channel: string; locale: string; subject: string | null; body: string }): TemplatePreview {
  const body = render(t.body, SAMPLE_VARS);
  const subject = t.subject === null ? null : render(t.subject, SAMPLE_VARS);
  const text = `${t.subject ?? ""}\n${t.body}`.toLowerCase();
  const warnings = BANNED_WORDING.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)).map((w) => `Contains "${w}"`);
  const channel = t.channel === "whatsapp" || t.channel === "sms" ? t.channel : "email";
  return { subject, body, sent: body.ok ? appendFooter(body.text, channel, t.locale, "https://pay.example.invalid/o/sample-token") : null, warnings };
}
