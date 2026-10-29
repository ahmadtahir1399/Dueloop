// The operator's SMTP password (SMTP_PASSWORD) for the operator's default host (setup-flow review, round 1: with
// operator SMTP, each business owner had to paste a password they cannot know). It must NEVER go to a host a
// tenant chose (SMTP_ALLOW_TENANT_HOST), and a tenant's own saved password always wins.
import { describe, expect, it } from 'vitest';
import { senderAllowed, smtpDefaultsFromEnv, smtpLogin } from '../src/index.ts';

const defaults = smtpDefaultsFromEnv({ SMTP_HOST: 'smtp.operator.example', SMTP_PORT: '587', SMTP_USER: 'relay-user', SMTP_PASSWORD: 'operator-secret' });

describe('smtpLogin', () => {
  it('reads SMTP_PASSWORD into the operator defaults', () => {
    expect(defaults).toMatchObject({ host: 'smtp.operator.example', user: 'relay-user', password: 'operator-secret' });
  });

  it('operator host, no tenant password => the operator password', () => {
    expect(smtpLogin({}, defaults, false, null)).toMatchObject({ host: 'smtp.operator.example', auth: { user: 'relay-user', pass: 'operator-secret' } });
  });

  it("operator host, tenant password saved => the tenant's password", () => {
    expect(smtpLogin({}, defaults, false, 'tenant-secret')?.auth).toEqual({ user: 'relay-user', pass: 'tenant-secret' });
  });

  it('a tenant-chosen host never receives the operator password', () => {
    const account = { smtp_host: 'smtp.tenant.example', smtp_user: 'tenant-user' };
    expect(smtpLogin(account, defaults, true, null)).toMatchObject({ host: 'smtp.tenant.example', auth: { user: 'tenant-user', pass: '' } });
    expect(smtpLogin(account, defaults, true, 'tenant-secret')?.auth).toEqual({ user: 'tenant-user', pass: 'tenant-secret' });
  });

  it('no user => no login at all; no settings => null', () => {
    expect(smtpLogin({}, smtpDefaultsFromEnv({ SMTP_HOST: 'relay.example' }), false, null)?.auth).toBeUndefined();
    expect(smtpLogin({}, null, false, null)).toBeNull();
  });
});

describe('review round 2: no password in clear; sender domains on the operator relay', () => {
  it('a password over a non-TLS port requires STARTTLS (never sent in clear)', () => {
    expect(smtpLogin({}, defaults, false, null)?.requireTLS).toBe(true);
    const implicit = smtpDefaultsFromEnv({ SMTP_HOST: 'smtp.operator.example', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASSWORD: 'p' });
    expect(smtpLogin({}, implicit, false, null)?.requireTLS).toBe(false); // already TLS from the first byte
    expect(smtpLogin({}, smtpDefaultsFromEnv({ SMTP_HOST: 'relay.example' }), false, null)?.requireTLS).toBe(false); // no login
  });

  it('SMTP_FROM_DOMAINS limits the sender domain on the operator host; unset = no limit', () => {
    const limited = smtpDefaultsFromEnv({ SMTP_HOST: 'smtp.operator.example', SMTP_FROM_DOMAINS: 'shop.example, Billing.Example ' });
    expect(senderAllowed('billing@shop.example', limited)).toBe(true);
    expect(senderAllowed('a@billing.example', limited)).toBe(true);
    expect(senderAllowed('ceo@bank.example', limited)).toBe(false);
    expect(senderAllowed('x@sub.shop.example', limited)).toBe(false);
    expect(senderAllowed('ceo@bank.example', defaults)).toBe(true);
  });
});
