// Channel settings form (found while writing docs/guides/getting-your-keys.html): an owner could save the SMTP
// password and the WhatsApp token but had no way to set the sender address or the WhatsApp phone number id, so a
// new tenant could not send email or WhatsApp without someone editing the database.
import { describe, expect, it } from 'vitest';
import { channelConfigFrom, mailboxConfigFrom, senderDomainAllowed } from '../lib/channel-config.ts';

describe('channelConfigFrom', () => {
  it('email: a safe sender address and a cleaned display name', () => {
    expect(channelConfigFrom({ channel: 'email', fromAddress: '  billing@shop.example ', fromName: ' Shop\r\nBcc: x@evil.example ' })).toEqual({
      ok: true,
      channel: 'email',
      config: { from_address: 'billing@shop.example', from_name: 'Shop Bcc: x@evil.example' },
      externalAccountId: null,
    });
  });

  it('email: an empty name is left out, so reminders fall back to the business name', () => {
    expect(channelConfigFrom({ channel: 'email', fromAddress: 'billing@shop.example', fromName: '   ' })).toMatchObject({ ok: true, config: { from_address: 'billing@shop.example' } });
    const r = channelConfigFrom({ channel: 'email', fromAddress: 'billing@shop.example', fromName: '' });
    expect(r.ok && 'from_name' in r.config).toBe(false);
  });

  it.each(['', 'billing', 'a b@shop.example', 'billing@shop.example, x@evil.example', 'Shop <billing@shop.example>', 'x@y@shop.example', `${'a'.repeat(250)}@shop.example`])(
    'email: refuses the unsafe or invalid address %j',
    (fromAddress) => {
      expect(channelConfigFrom({ channel: 'email', fromAddress, fromName: '' })).toEqual({ ok: false, reason: 'Enter one plain email address, like billing@yourbusiness.example.' });
    },
  );

  it('whatsapp: the phone number id is digits only and also becomes the inbound lookup key', () => {
    expect(channelConfigFrom({ channel: 'whatsapp', phoneNumberId: ' 123456789012345 ' })).toEqual({
      ok: true,
      channel: 'whatsapp',
      config: { phone_number_id: '123456789012345' },
      externalAccountId: '123456789012345',
    });
  });

  it.each(['', '12ab', '+44 7700 900123', '1'.repeat(33), '12.5'])('whatsapp: refuses %j', (phoneNumberId) => {
    expect(channelConfigFrom({ channel: 'whatsapp', phoneNumberId })).toEqual({ ok: false, reason: 'The phone number ID is the number Meta shows (digits only), not the phone number.' });
  });

  it('SMTP_FROM_DOMAINS (operator relay) limits the sender domain; unset or empty = any', () => {
    expect(senderDomainAllowed('billing@shop.example', 'shop.example, other.example')).toBe(true);
    expect(senderDomainAllowed('ceo@bank.example', 'shop.example')).toBe(false);
    expect(senderDomainAllowed('ceo@bank.example', undefined)).toBe(true);
    expect(senderDomainAllowed('ceo@bank.example', '')).toBe(true);
  });

  it('own SMTP server (only when the operator allows tenant hosts): host, port, user and TLS are validated', () => {
    const base = { channel: 'email' as const, fromAddress: 'billing@shop.example', fromName: '' };
    expect(channelConfigFrom({ ...base, smtp: { host: 'smtp.shop.example', port: '465', user: 'billing@shop.example', secure: true } })).toEqual({
      ok: true,
      channel: 'email',
      config: { from_address: 'billing@shop.example', smtp_host: 'smtp.shop.example', smtp_port: 465, smtp_user: 'billing@shop.example', smtp_secure: true },
      externalAccountId: null,
    });
    for (const host of ['', 'smtp shop', 'http://x.example', 'a/b', 'x'.repeat(254), '127.0.0.1', '169.254.169.254', 'localhost']) expect(channelConfigFrom({ ...base, smtp: { host, port: '587', user: 'u', secure: false } }).ok).toBe(false);
    for (const port of ['0', '70000', 'abc', '']) expect(channelConfigFrom({ ...base, smtp: { host: 'smtp.shop.example', port, user: 'u', secure: false } }).ok).toBe(false);
    expect(channelConfigFrom({ ...base, smtp: { host: 'smtp.shop.example', port: '587', user: `a${String.fromCharCode(13, 10)}b`, secure: false } }).ok).toBe(false);
  });

  it('refuses any other channel', () => {
    expect(channelConfigFrom({ channel: 'slack' } as never)).toEqual({ ok: false, reason: 'Choose email or WhatsApp.' });
  });
});

describe('mailboxConfigFrom', () => {
  const base = { host: 'imap.shop.example', port: '993', user: 'billing@shop.example', mailbox: 'INBOX', replyTo: '' };

  it('a mailbox, cleaned; the folder defaults to INBOX and an empty reply address is no reply address', () => {
    expect(mailboxConfigFrom({ ...base, host: ' imap.shop.example ', mailbox: '  ' })).toEqual({
      ok: true,
      config: { host: 'imap.shop.example', port: 993, user: 'billing@shop.example', mailbox: 'INBOX' },
      replyTo: null,
    });
    expect(mailboxConfigFrom({ ...base, replyTo: ' replies@shop.example ' })).toMatchObject({ ok: true, replyTo: 'replies@shop.example' });
  });

  it.each(['', 'imap shop', 'http://x.example', 'a/b', '127.0.0.1', '169.254.169.254', 'localhost'])('refuses the host %j', (host) => {
    expect(mailboxConfigFrom({ ...base, host }).ok).toBe(false);
  });

  it.each(['', '0', '25', '587', '6379', '70000', 'abc'])('only the two encrypted IMAP ports: refuses %j', (port) => {
    expect(mailboxConfigFrom({ ...base, port })).toEqual({ ok: false, reason: 'Choose port 993 or 143.' });
  });

  it('refuses control characters in the login and the folder (no IMAP command injection)', () => {
    const crlf = String.fromCharCode(13, 10);
    expect(mailboxConfigFrom({ ...base, user: `a${crlf}b` }).ok).toBe(false);
    expect(mailboxConfigFrom({ ...base, mailbox: `INBOX${crlf}x LOGOUT` }).ok).toBe(false);
    expect(mailboxConfigFrom({ ...base, user: '' }).ok).toBe(false);
    expect(mailboxConfigFrom({ ...base, mailbox: 'x'.repeat(201) }).ok).toBe(false);
  });

  it.each(['replies', 'a b@shop.example', 'Shop <replies@shop.example>', 'a@shop.example, x@evil.example'])('refuses the reply address %j', (replyTo) => {
    expect(mailboxConfigFrom({ ...base, replyTo }).ok).toBe(false);
  });
});
