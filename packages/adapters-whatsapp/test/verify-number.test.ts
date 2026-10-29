// Review round 2: inbound WhatsApp is routed by phone_number_id, so a business must not be able to claim another
// business's number. Saving it requires Meta to confirm, with the business's OWN token, that the token can read
// that number: GET https://graph.facebook.com/<version>/<PHONE_NUMBER_ID> (Meta Cloud API "Phone Numbers"
// reference, read 2026-10-30). How Meta answers a token without access is not documented there; anything but a
// 200 with the same id counts as "not confirmed".
import { describe, expect, it } from 'vitest';
import { verifyPhoneNumberId } from '../src/index.ts';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; auth: string | null }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}

describe('verifyPhoneNumberId', () => {
  it('asks Meta with the tenant token and accepts only the same id', async () => {
    const { f, calls } = fakeFetch(200, { id: '123456789', display_phone_number: '+1 555 0100' });
    expect(await verifyPhoneNumberId({ graphVersion: 'v26.0', token: 'tok', phoneNumberId: '123456789', fetch: f, timeoutMs: 1000 })).toBe(true);
    expect(calls[0]).toEqual({ url: 'https://graph.facebook.com/v26.0/123456789?fields=id', auth: 'Bearer tok' });
  });
  it.each<[number, unknown]>([
    [200, { id: '999' }],
    [400, { error: { message: 'Unsupported get request', code: 100 } }],
    [403, { error: { code: 10 } }],
    [500, {}],
  ])('HTTP %i %j => not confirmed', async (status, body) => {
    const { f } = fakeFetch(status, body);
    expect(await verifyPhoneNumberId({ graphVersion: 'v26.0', token: 'tok', phoneNumberId: '123456789', fetch: f, timeoutMs: 1000 })).toBe(false);
  });
  it('a network error or a bad id never throws: not confirmed', async () => {
    const f = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await verifyPhoneNumberId({ graphVersion: 'v26.0', token: 'tok', phoneNumberId: '123', fetch: f, timeoutMs: 1000 })).toBe(false);
    expect(await verifyPhoneNumberId({ graphVersion: 'v26.0', token: 'tok', phoneNumberId: '../me', fetch: f, timeoutMs: 1000 })).toBe(false);
  });
});
