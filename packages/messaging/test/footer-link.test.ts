// Prompt 6 (issue F/L): the footer is appended after rendering and carries the opt-out link when one was issued.
// After review round 2: email replies are not read in production (no IMAP poller runs; ADR 0031 status), so an
// email footer must never tell the customer to "reply STOP". Email opts out through the link (and the RFC 8058
// header); WhatsApp replies ARE processed, so WhatsApp keeps "Reply STOP".
import { describe, expect, it } from 'vitest';
import { appendFooter, FOOTER_SEPARATOR, footerFor } from '../src/index.ts';

describe('appendFooter', () => {
  it('email with a link: the link is the way to stop; no reply-STOP promise', () => {
    const out = appendFooter('Body text', 'email', 'en', 'https://pay.example.test/o/TOKEN');
    expect(out.startsWith(`Body text${FOOTER_SEPARATOR}`)).toBe(true);
    expect(out).toBe(`Body text${FOOTER_SEPARATOR}You are receiving this because you have an open invoice with us. To stop these reminders, use this link: https://pay.example.test/o/TOKEN`);
  });
  it('email without a link (receipts, previews): a person reads replies, so it says to reply, not to type STOP', () => {
    expect(appendFooter('B', 'email', 'en')).toBe(`B${FOOTER_SEPARATOR}You are receiving this because you have an open invoice with us. To stop these reminders, reply to this email.`);
  });
  it.each(['en', 'de', 'de-AT', 'ur', 'ur-Latn', 'fr'])('email in %s never mentions STOP, with or without a link', (locale) => {
    expect(appendFooter('B', 'email', locale)).not.toMatch(/STOP/);
    expect(appendFooter('B', 'email', locale, 'https://x.test/o/T')).not.toMatch(/STOP/);
    expect(appendFooter('B', 'email', locale, 'https://x.test/o/T').endsWith('https://x.test/o/T')).toBe(true);
  });
  it('WhatsApp keeps "Reply STOP" (those replies are processed) and adds the link after it', () => {
    const out = appendFooter('B', 'whatsapp', 'en', 'https://x.test/o/T');
    expect(out).toBe(`B${FOOTER_SEPARATOR}Reply STOP to stop these reminders.\nOr stop them here: https://x.test/o/T`);
    expect(footerFor('whatsapp', 'de')).toContain('STOP');
  });
  it('an edited body cannot remove it: the footer always comes last', () => {
    const edited = `Pay now${FOOTER_SEPARATOR}fake footer`;
    expect(appendFooter(edited, 'email', 'en', 'https://x.test/o/T').endsWith('https://x.test/o/T')).toBe(true);
  });
});
