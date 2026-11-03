// D11: each form schema accepts a valid body, rejects each invalid case with the §5.6 wording, and uses exactly the
// FormData names the existing server action reads (so the request body is unchanged, D10).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as F from '../forms/schemas.ts';

type Parsed = { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } };
const msg = (r: Parsed, path: string) => (r.success ? undefined : r.error?.issues.find((i) => i.path.join('.') === path)?.message);
const action = (rel: string) => readFileSync(new URL(`../app/(staff)/${rel}`, import.meta.url), 'utf8');

describe('auth', () => {
  it('sign in', () => {
    expect(F.signInSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(msg(F.signInSchema.safeParse({ email: 'nope', password: 'x' }), 'email')).toBe('Enter an email address like name@example.com.');
    expect(msg(F.signInSchema.safeParse({ email: '', password: 'x' }), 'email')).toBe('Enter your email address.');
  });
  it('sign up', () => {
    expect(F.signUpSchema.safeParse({ email: 'a@b.co', password: '12345678', confirmPassword: '12345678' }).success).toBe(true);
    expect(msg(F.signUpSchema.safeParse({ email: 'a@b.co', password: 'short', confirmPassword: 'short' }), 'password')).toBe('Use at least 8 characters.');
    expect(msg(F.signUpSchema.safeParse({ email: 'a@b.co', password: '12345678', confirmPassword: '87654321' }), 'confirmPassword')).toBe("The passwords don't match.");
    const src = action('sign-in/actions.ts');
    for (const k of ['email', 'password']) expect(src).toContain(`"${k}"`);
  });
});

describe('payment (F07/F09)', () => {
  const s = F.paymentSchema({ currency: 'USD', today: '2026-11-02' });
  const ok = { amount: '1,250.50', decimal: '.', date: '2026-11-01', bank_ref: 'FT-1', note: '' };
  it('accepts a valid payment and grouping', () => {
    expect(s.safeParse(ok).success).toBe(true);
    expect(s.safeParse({ ...ok, amount: '1.250,50', decimal: ',' }).success).toBe(true);
  });
  it('rejects bad amounts with the currency-specific example', () => {
    expect(msg(s.safeParse({ ...ok, amount: '12.345' }), 'amount')).toBe('Enter an amount like 1200.00.');
    expect(msg(s.safeParse({ ...ok, amount: '0' }), 'amount')).toBe('Enter an amount like 1200.00.');
    expect(msg(F.paymentSchema({ currency: 'JPY', today: '2026-11-02' }).safeParse({ ...ok, amount: '1.5' }), 'amount')).toBe('Enter an amount like 1200.');
    expect(msg(s.safeParse({ ...ok, amount: '' }), 'amount')).toBe('Enter the amount you received.');
  });
  it('rejects a future date and a missing bank reference (unless a proof allows none)', () => {
    expect(msg(s.safeParse({ ...ok, date: '2026-11-03' }), 'date')).toBe("The payment date can't be in the future.");
    expect(msg(s.safeParse({ ...ok, bank_ref: '' }), 'bank_ref')).toBe('Enter the bank reference so this payment can be traced.');
    expect(F.paymentSchema({ currency: 'USD', today: '2026-11-02', allowNoBankRef: true }).safeParse({ ...ok, bank_ref: '', no_bank_ref: '1' }).success).toBe(true);
  });
  it('field names are the ones the server action reads', () => {
    const src = action('(app)/payments/actions.ts');
    for (const k of ['amount', 'date', 'bank_ref', 'decimal', 'note']) expect(src).toContain(`"${k}"`);
  });
});

describe('decisions', () => {
  it('reject approval needs a reason (server: >= 3 characters)', () => {
    expect(F.rejectApprovalSchema.safeParse({ note: 'no' }).success).toBe(false);
    expect(F.rejectApprovalSchema.safeParse({ note: 'wrong amount' }).success).toBe(true);
    expect(action('(app)/approvals/actions.ts')).toContain('"note"');
  });
  it('bulk approve needs the exact count', () => {
    expect(F.bulkApproveSchema.safeParse({ approval: ['a', 'b'], confirm_count: '2' }).success).toBe(true);
    expect(msg(F.bulkApproveSchema.safeParse({ approval: ['a', 'b'], confirm_count: '3' }), 'confirm_count')).toBe('You selected 2. Type 2 to confirm.');
    expect(msg(F.bulkApproveSchema.safeParse({ approval: false, confirm_count: '0' }), 'approval')).toBe('Select at least one approval.');
  });
  it('task and promise notes', () => {
    expect(F.noteRequiredSchema.safeParse({ note: 'ok' }).success).toBe(false);
    expect(F.noteRequiredSchema.safeParse({ note: 'paid by phone' }).success).toBe(true);
  });
  it('reconcile needs the check', () => {
    expect(F.reconcileSchema.safeParse({ checked: false }).success).toBe(false);
    expect(F.reconcileSchema.safeParse({ checked: '1' }).success).toBe(true);
    expect(action('(app)/messages/actions.ts')).toContain('"checked"');
  });
  it('consent', () => {
    expect(F.consentSchema.safeParse({ channel: 'whatsapp', source: 'signed order form' }).success).toBe(true);
    expect(F.consentSchema.safeParse({ channel: 'sms', source: 'signed order form' }).success).toBe(false);
    expect(F.consentSchema.safeParse({ channel: 'email', source: 'x' }).success).toBe(false);
  });
});

describe('setup', () => {
  it('settings', () => {
    const ok = { timezone: 'Europe/London', quiet_start: '21', quiet_end: '8', approval_mode: 'always', promise_acceptance: 'auto', budget: '0' };
    expect(F.settingsSchema.safeParse(ok).success).toBe(true);
    expect(msg(F.settingsSchema.safeParse({ ...ok, timezone: 'GMT+5' }), 'timezone')).toBe('Choose a time zone like Europe/London.');
    expect(F.settingsSchema.safeParse({ ...ok, quiet_start: '24' }).success).toBe(false);
    expect(F.settingsSchema.safeParse({ ...ok, budget: '1.5' }).success).toBe(false);
    const src = action('(app)/settings/admin-actions.ts');
    for (const k of Object.keys(ok)) expect(src).toContain(`"${k}"`);
  });
  it('kill switch word', () => {
    expect(F.killSwitchSchema('PAUSE').safeParse({ confirm: 'pause' }).success).toBe(true);
    expect(msg(F.killSwitchSchema('PAUSE').safeParse({ confirm: 'stop' }), 'confirm')).toBe('Type PAUSE exactly to confirm.');
  });
  it('onboarding, holiday, invite, API key', () => {
    expect(F.onboardingSchema.safeParse({ name: 'Acme', timezone: 'Asia/Karachi', currency: 'pkr', quietStart: '20', quietEnd: '9' }).success).toBe(true);
    expect(F.onboardingSchema.safeParse({ name: '', timezone: 'Asia/Karachi', currency: 'PKR', quietStart: '20', quietEnd: '9' }).success).toBe(false);
    expect(F.holidaySchema.safeParse({ date: '2026-12-25' }).success).toBe(true);
    expect(F.holidaySchema.safeParse({ date: '25/12/2026' }).success).toBe(false);
    expect(F.inviteSchema.safeParse({ email: 'a@b.co', role: 'collector' }).success).toBe(true);
    expect(F.inviteSchema.safeParse({ email: 'a@b.co', role: 'admin' }).success).toBe(false);
    expect(F.apiKeySchema.safeParse({ name: '' }).success).toBe(false);
  });
});
