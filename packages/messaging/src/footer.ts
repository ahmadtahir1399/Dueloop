// Opt-out footer, appended AFTER rendering and after any human edit, so an edit can never remove it.
// Per channel and locale (language subtag); English is the default. Wording is not legal advice.
//
// Email never says "reply STOP": email replies are not read by the product in production (no IMAP poller runs,
// ADR 0031), so that promise would be false and an opt-out would be lost. Email stops through the opt-out link
// (plus the RFC 8058 header the worker adds). Without a link (receipts, previews) it asks for a reply, which a
// person at the business reads. WhatsApp replies ARE processed (webhooks + processor), so WhatsApp keeps STOP.
import type { Channel } from '@dueloop/core';

interface EmailFooter {
  /** Why the customer gets this. */
  readonly reason: string;
  /** Followed by a space and the opt-out URL. */
  readonly withLink: string;
  /** When no link was issued. */
  readonly withoutLink: string;
}

const EMAIL: Readonly<Record<string, EmailFooter>> = {
  en: {
    reason: 'You are receiving this because you have an open invoice with us.',
    withLink: 'To stop these reminders, use this link:',
    withoutLink: 'To stop these reminders, reply to this email.',
  },
  de: {
    reason: 'Sie erhalten diese Nachricht wegen einer offenen Rechnung.',
    withLink: 'Um diese Erinnerungen zu beenden, nutzen Sie diesen Link:',
    withoutLink: 'Um diese Erinnerungen zu beenden, antworten Sie auf diese E-Mail.',
  },
  ur: {
    reason: 'آپ کو یہ پیغام ایک واجب الادا انوائس کی وجہ سے ملا ہے۔',
    withLink: 'یاد دہانیاں یہاں بند کریں:',
    withoutLink: 'یاد دہانیاں بند کرنے کے لیے اس ای میل کا جواب دیں۔',
  },
};

const OTHER: Readonly<Record<string, Readonly<Partial<Record<Exclude<Channel, 'email'>, string>>>>> = {
  en: {
    whatsapp: 'Reply STOP to stop these reminders.',
    sms: 'Reply STOP to opt out.',
  },
  de: {
    whatsapp: 'Antworten Sie mit STOP, um diese Erinnerungen zu beenden.',
  },
};

export const FOOTER_SEPARATOR = '\n\n--\n';

const langOf = (locale: string) => locale.split('-')[0]?.toLowerCase() ?? 'en';
const emailFor = (locale: string): EmailFooter => EMAIL[langOf(locale)] ?? (EMAIL.en as EmailFooter);

/** The footer text without a link (for email: the "reply to this email" form). */
export function footerFor(channel: Channel, locale: string): string {
  if (channel === 'email') {
    const e = emailFor(locale);
    return `${e.reason} ${e.withoutLink}`;
  }
  return OTHER[langOf(locale)]?.[channel] ?? OTHER.en?.[channel] ?? 'Reply STOP to stop these reminders.';
}

/** Prompt 6: the opt-out page link line, added after the reply-STOP text when the worker issued a link. */
const OPT_OUT_LINE: Readonly<Record<string, string>> = {
  en: 'Or stop them here:',
  de: 'Oder hier abbestellen:',
  ur: 'یا یہاں بند کریں:',
};

export function appendFooter(body: string, channel: Channel, locale: string, optOutUrl: string | null = null): string {
  const head = `${body.trimEnd()}${FOOTER_SEPARATOR}`;
  if (channel === 'email') {
    const e = emailFor(locale);
    return optOutUrl ? `${head}${e.reason} ${e.withLink} ${optOutUrl}` : `${head}${e.reason} ${e.withoutLink}`;
  }
  const link = optOutUrl ? `\n${OPT_OUT_LINE[langOf(locale)] ?? OPT_OUT_LINE.en} ${optOutUrl}` : '';
  return `${head}${footerFor(channel, locale)}${link}`;
}
