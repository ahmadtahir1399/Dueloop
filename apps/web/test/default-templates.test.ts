// A new business got a default policy (steps friendly / nudge / firm by email) but no templates, and nothing in
// the UI could create one, so its first reminder was parked as template_missing (found by the setup-flow review).
import { DEFAULT_TEMPLATES } from '@dueloop/messaging';
import { describe, expect, it } from 'vitest';
import { missingStandardTemplates, standardTemplateRows } from '../lib/default-templates.ts';

const T = '00000000-0000-4000-8000-000000000001';

describe('standard templates', () => {
  it('are the email DEFAULT_TEMPLATES (one source of wording), for this tenant', () => {
    const rows = standardTemplateRows(T);
    expect(rows.length).toBe(DEFAULT_TEMPLATES.filter((t) => t.channel === 'email').length);
    for (const r of rows) {
      expect(r).toMatchObject({ tenant_id: T, channel: 'email' });
      const d = DEFAULT_TEMPLATES.find((t) => t.templateKey === r.template_key && t.channel === 'email');
      expect(r).toEqual({ tenant_id: T, template_key: d?.templateKey, channel: 'email', locale: d?.locale, tone: d?.tone, subject: d?.subject, body: d?.body });
    }
  });

  it("cover every template key of the onboarding policy (create_tenant_impl's steps)", () => {
    const keys = standardTemplateRows(T).map((r) => r.template_key);
    for (const k of ['friendly', 'nudge', 'firm']) expect(keys).toContain(k);
  });

  it('never include WhatsApp: those need a provider-approved template name', () => {
    expect(standardTemplateRows(T).some((r) => r.channel !== 'email')).toBe(false);
  });

  it('missingStandardTemplates lists only the keys a tenant does not have yet (english email)', () => {
    expect(missingStandardTemplates([])).toEqual(standardTemplateRows(T).map((r) => r.template_key));
    expect(missingStandardTemplates([{ template_key: 'friendly', channel: 'email', locale: 'en' }, { template_key: 'nudge', channel: 'whatsapp', locale: 'en' }])).not.toContain('friendly');
    expect(missingStandardTemplates([{ template_key: 'nudge', channel: 'whatsapp', locale: 'en' }])).toContain('nudge');
  });
});
