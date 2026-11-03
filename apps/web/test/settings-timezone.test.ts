// Redesign 8b (CONFLICTS C-42): the time zone is now chosen from a list, so the e2e test can no longer type a bad
// zone. This keeps the server-side refusal covered at the action boundary: settingsAction passes the posted
// `timezone` to core's validateSettings and returns its error BEFORE calling save_tenant_settings, and that validator
// refuses a non-IANA zone. (The database trigger is covered by supabase/tests/issues/issue_i_timezone.test.sql.)
import { readFileSync } from 'node:fs';
import { validateSettings } from '@dueloop/core';
import { describe, expect, it } from 'vitest';
import { settingsSchema } from '../forms/schemas.ts';

const action = readFileSync(new URL('../app/(staff)/(app)/settings/admin-actions.ts', import.meta.url), 'utf8');
const body = action.slice(action.indexOf('export async function settingsAction'));

describe('settings: a non-IANA time zone is refused on the server', () => {
  it('core validateSettings refuses it with an IANA message', () => {
    for (const tz of ['GMT+5', 'Mars/Olympus', '+05:00', '']) {
      const v = validateSettings({ timezone: tz, quietHours: { startHour: 20, endHour: 9 }, holidays: [] });
      expect(v.ok, tz).toBe(false);
      if (!v.ok) expect(v.errors.map((e) => e.message).join(' ')).toMatch(/IANA/);
    }
    expect(validateSettings({ timezone: 'Europe/London', quietHours: { startHour: 20, endHour: 9 }, holidays: [] }).ok).toBe(true);
  });

  it('settingsAction validates the posted timezone and returns before the RPC', () => {
    const read = body.indexOf('textField(form, "timezone"');
    const validate = body.indexOf('validateSettings({ timezone');
    const bail = body.indexOf('if (!v.ok) return');
    const rpc = body.indexOf('rpc("save_tenant_settings"');
    expect([read, validate, bail, rpc].every((i) => i > 0)).toBe(true);
    expect(read < validate && validate < bail && bail < rpc).toBe(true);
  });

  it('the client schema refuses it too (first check only; the server decides)', () => {
    const base = { quiet_start: '20', quiet_end: '9', approval_mode: 'always', promise_acceptance: 'auto', budget: '0' };
    expect(settingsSchema.safeParse({ ...base, timezone: 'GMT+5' }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, timezone: 'Europe/London' }).success).toBe(true);
  });
});
