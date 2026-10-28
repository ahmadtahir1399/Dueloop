// Opt-out footer, appended AFTER rendering and after any human edit, so an edit can never remove it.
// Per channel and locale (language subtag); English is the default. Wording is not legal advice.
import type { Channel } from '@dueloop/core';

const FOOTERS: Readonly<Record<string, Readonly<Partial<Record<Channel, string>>>>> = {
  en: {
    email: 'You are receiving this because you have an open invoice with us. To stop these reminders, reply STOP.',
    whatsapp: 'Reply STOP to stop these reminders.',
    sms: 'Reply STOP to opt out.',
  },
  de: {
    email: 'Sie erhalten diese Nachricht wegen einer offenen Rechnung. Um diese Erinnerungen zu beenden, antworten Sie mit STOP.',
    whatsapp: 'Antworten Sie mit STOP, um diese Erinnerungen zu beenden.',
  },
  ur: {
    email: 'آپ کو یہ پیغام ایک واجب الادا انوائس کی وجہ سے ملا ہے۔ یاد دہانیاں بند کرنے کے لیے STOP لکھ کر جواب دیں۔',
  },
};

export const FOOTER_SEPARATOR = '\n\n--\n';

export function footerFor(channel: Channel, locale: string): string {
  const lang = locale.split('-')[0]?.toLowerCase() ?? 'en';
  return FOOTERS[lang]?.[channel] ?? FOOTERS.en?.[channel] ?? 'Reply STOP to stop these reminders.';
}

/** Prompt 6: the opt-out page link line, added after the reply-STOP text when the worker issued a link. */
const OPT_OUT_LINE: Readonly<Record<string, string>> = {
  en: 'Or stop them here:',
  de: 'Oder hier abbestellen:',
  ur: 'یا یہاں بند کریں:',
};

export function appendFooter(body: string, channel: Channel, locale: string, optOutUrl: string | null = null): string {
  const lang = locale.split('-')[0]?.toLowerCase() ?? 'en';
  const link = optOutUrl ? `
${OPT_OUT_LINE[lang] ?? OPT_OUT_LINE.en} ${optOutUrl}` : '';
  return `${body.trimEnd()}${FOOTER_SEPARATOR}${footerFor(channel, locale)}${link}`;
}
