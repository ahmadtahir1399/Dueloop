// The demo seed's templates must stay identical to DEFAULT_TEMPLATES (one source of wording; banned-word
// tests run against DEFAULT_TEMPLATES).
import { DEFAULT_TEMPLATES } from '@dueloop/messaging';
import { afterAll, expect, it } from 'vitest';
import { pool, q } from './harness.ts';

afterAll(() => pool.end());

it('seeded Demo Agency templates equal DEFAULT_TEMPLATES', async () => {
  const rows = await q<{ template_key: string; channel: string; locale: string; tone: string; subject: string | null; body: string }>(
    `select template_key, channel, locale, tone, subject, body from public.templates
     where tenant_id = '5eed0000-0000-4000-8000-00000000000a' order by template_key, channel`,
  );
  const expected = [...DEFAULT_TEMPLATES]
    .map((t) => ({ template_key: t.templateKey, channel: t.channel, locale: t.locale, tone: t.tone, subject: t.subject, body: t.body }))
    .sort((a, b) => `${a.template_key}${a.channel}`.localeCompare(`${b.template_key}${b.channel}`));
  expect(rows).toEqual(expected);
});
