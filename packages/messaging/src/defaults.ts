// Default reminder templates (English). Polite and factual on purpose: no threats, no legal language.
// This is NOT legal advice; collection messaging rules differ by market and each needs review (guide 2.4).
import type { Channel } from '@dueloop/core';

export interface DefaultTemplate {
  readonly templateKey: string;
  readonly channel: Channel;
  readonly locale: string;
  readonly tone: 'friendly' | 'neutral' | 'firm';
  readonly subject: string | null;
  readonly body: string;
}

export const DEFAULT_TEMPLATES: readonly DefaultTemplate[] = [
  {
    templateKey: 'friendly',
    channel: 'email',
    locale: 'en',
    tone: 'friendly',
    subject: 'Friendly reminder: invoice {{invoice_number}}',
    body:
      'Hi {{customer_name}},\n\nA quick reminder that invoice {{invoice_number}} for {{amount_due}} was due on {{due_date}}. ' +
      'If you have already paid, thank you, and please ignore this message.\n\n' +
      '{{payment_block}}\n\nThank you,\n{{business_name}}',
  },
  {
    templateKey: 'nudge',
    channel: 'email',
    locale: 'en',
    tone: 'neutral',
    subject: 'Invoice {{invoice_number}} is {{days_overdue}} days overdue',
    body:
      'Hello {{customer_name}},\n\nOur records show invoice {{invoice_number}} for {{amount_due}} is now {{days_overdue}} days past its due date ({{due_date}}). ' +
      'Could you let us know when we can expect payment?\n\n{{payment_block}}\n\nRegards,\n{{business_name}}',
  },
  {
    templateKey: 'firm',
    channel: 'email',
    locale: 'en',
    tone: 'firm',
    subject: 'Action needed: invoice {{invoice_number}}',
    body:
      'Dear {{customer_name}},\n\nInvoice {{invoice_number}} for {{amount_due}} remains unpaid {{days_overdue}} days after the due date of {{due_date}}. ' +
      'Please arrange payment or reply to agree a date.\n\n{{payment_block}}\n\n{{business_name}}',
  },
  {
    templateKey: 'nudge',
    channel: 'whatsapp',
    locale: 'en',
    tone: 'neutral',
    subject: null,
    body: 'Hello {{customer_name}}, invoice {{invoice_number}} for {{amount_due}} was due on {{due_date}}. Please quote {{reference_code}} when paying. {{business_name}}',
  },
  // Receipts (prompt 5, issue K): plain confirmations, no marketing.
  {
    templateKey: 'receipt',
    channel: 'email',
    locale: 'en',
    tone: 'neutral',
    subject: 'Payment received: invoice {{invoice_number}}',
    body: 'Hi {{customer_name}},\n\nThank you. We received {{amount_received}} for invoice {{invoice_number}}.\nRemaining balance: {{balance_remaining}}.\n\n{{business_name}}',
  },
  {
    templateKey: 'receipt',
    channel: 'whatsapp',
    locale: 'en',
    tone: 'neutral',
    subject: null,
    body: 'Hello {{customer_name}}, we received {{amount_received}} for invoice {{invoice_number}}. Remaining balance: {{balance_remaining}}. {{business_name}}',
  },
];

/** Words that must never appear in default reminder wording (threatening or legally loaded). */
export const BANNED_WORDING = [
  'legal action',
  'lawyer',
  'solicitor',
  'attorney',
  'bailiff',
  'court',
  'sue',
  'arrest',
  'police',
  'criminal',
  'jail',
  'prison',
  'debt collector',
  'blacklist',
  'credit score',
  'final warning',
  'or else',
];
