// Channel settings form (found while writing docs/guides/getting-your-keys.html): an owner could save the SMTP
// password and the WhatsApp token but had no way to set the sender address or the WhatsApp phone number id, so a
// new tenant could not send email or WhatsApp without someone editing the database.
import { describe, expect, it } from 'vitest';
import { channelConfigFrom } from '../lib/channel-config.ts';

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

  it('refuses any other channel', () => {
    expect(channelConfigFrom({ channel: 'slack' } as never)).toEqual({ ok: false, reason: 'Choose email or WhatsApp.' });
  });
});
