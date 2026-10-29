// Review round 2: a pending WhatsApp template in the customer's language hid an APPROVED English one, so the step
// parked as template_unapproved although an approved text existed. Approved WhatsApp templates now win, in the
// same language order (exact locale, language, English); without any approved one the first match is returned
// and the router reports template_unapproved as before.
import { describe, expect, it } from 'vitest';
import { pickTemplate, type TemplateRow } from '../src/context.ts';

const row = (locale: string, providerStatus: string | null, channel: 'email' | 'whatsapp' = 'whatsapp'): TemplateRow => ({
  templateKey: 'nudge',
  channel,
  locale,
  subject: channel === 'email' ? 's' : null,
  body: `${locale}:${providerStatus}`,
  providerTemplateName: channel === 'whatsapp' ? 'n' : null,
  providerLanguage: channel === 'whatsapp' ? locale : null,
  providerStatus,
});

describe('pickTemplate', () => {
  it('WhatsApp: an approved English template beats a pending one in the customer language', () => {
    expect(pickTemplate([row('ur', 'pending'), row('en', 'approved')], 'nudge', 'whatsapp', 'ur')?.body).toBe('en:approved');
  });
  it('WhatsApp: an approved one in the customer language still wins over approved English', () => {
    expect(pickTemplate([row('en', 'approved'), row('ur', 'approved')], 'nudge', 'whatsapp', 'ur')?.body).toBe('ur:approved');
  });
  it('WhatsApp: none approved => the usual language match (the router then says template_unapproved)', () => {
    expect(pickTemplate([row('en', 'pending'), row('ur', 'needs_resubmission')], 'nudge', 'whatsapp', 'ur')?.body).toBe('ur:needs_resubmission');
  });
  it('email is unchanged: language order only', () => {
    expect(pickTemplate([row('en', null, 'email'), row('de', null, 'email')], 'nudge', 'email', 'de-AT')?.body).toBe('de:null');
    expect(pickTemplate([row('en', null, 'email')], 'nudge', 'email', 'fr')?.body).toBe('en:null');
  });
});
