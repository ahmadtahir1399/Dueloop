import { describe, expect, it } from 'vitest';
import { generateReferenceCode } from '@dueloop/ingest/parsers';
import { BankTransferProvider, FAKE_SIGNATURE_HEADER, FakeGateway, signFake, verifyFake } from '../src/index.ts';

const REF = generateReferenceCode(() => 3);
const T0 = new Date('2026-03-02T10:00:00Z');

function clockAt(d: Date) {
  const c = { at: d, now: () => c.at };
  return c;
}

describe('BankTransferProvider', () => {
  it('returns the tenant text and the reference code; no webhooks', async () => {
    const p = new BankTransferProvider('IBAN on file');
    expect(await p.createPaymentRequest({ invoiceId: 'i', amountMinor: 500, reference: REF, currency: 'GBP' })).toEqual({ kind: 'bank_instructions', bankText: 'IBAN on file', reference: REF, amountMinor: 500, currency: 'GBP' });
    await expect(p.handleWebhook()).rejects.toThrow();
  });
  it('refuses a reference code that fails the prompt 2 validator', async () => {
    await expect(new BankTransferProvider('x').createPaymentRequest({ invoiceId: 'i', amountMinor: 1, reference: 'NOTACODE' })).rejects.toThrow('invalid reference code');
  });
});

describe('fake signature', () => {
  const body = '{"a":1}';
  it('verifies over the raw body; any edit, other secret, or staleness fails', () => {
    const h = signFake('s1', body, T0);
    expect(() => verifyFake('s1', body, h, T0)).not.toThrow();
    expect(() => verifyFake('s1', '{"a":2}', h, T0)).toThrow('bad_signature');
    expect(() => verifyFake('s2', body, h, T0)).toThrow('bad_signature');
    expect(() => verifyFake('s1', body, h, new Date(T0.getTime() + 301_000))).toThrow('stale_signature');
    expect(() => verifyFake('s1', body, undefined, T0)).toThrow('missing_signature');
    expect(() => verifyFake('s1', body, 't=1,v1=zz', T0)).toThrow('malformed_signature');
  });
});

describe('FakeGateway', () => {
  it('is idempotent per key and translates signed deliveries', async () => {
    const clock = clockAt(T0);
    const g = new FakeGateway({ secret: 'whsec', clock });
    const a = await g.createPaymentRequest({ invoiceId: 'i', amountMinor: 1000, currency: 'JPY', reference: REF, idempotencyKey: 'k1' });
    const b = await g.createPaymentRequest({ invoiceId: 'i', amountMinor: 1000, currency: 'JPY', reference: REF, idempotencyKey: 'k1' });
    expect(b.providerObjectId).toBe(a.providerObjectId);
    const pay = g.pay(a.providerObjectId ?? '');
    const [d] = g.drain();
    const evs = await g.handleWebhook(d?.rawBody ?? '', d?.headers ?? {});
    expect(evs).toEqual([{ type: 'payment_confirmed', providerRef: pay, amountMinor: 1000, currency: 'JPY', paidAt: new Date(Math.floor(T0.getTime() / 1000) * 1000), requestRef: a.providerObjectId, providerEventId: expect.any(String), livemode: false }]);
    expect(await g.getStatus(a.providerObjectId ?? '')).toMatchObject([{ type: 'payment_confirmed', providerRef: pay }]);
  });

  it('delays, duplicates, reverses; signs at hand-out time; refuses inactive links unless racing', async () => {
    const clock = clockAt(T0);
    const g = new FakeGateway({ secret: 'whsec', clock });
    const { providerObjectId: id = '' } = await g.createPaymentRequest({ invoiceId: 'i', amountMinor: 50, currency: 'GBP', reference: REF });
    const p = g.pay(id, { async: true });
    g.settle(p, 'succeeded', 600);
    expect(g.drain()).toHaveLength(1); // processing only; the confirmation is delayed
    clock.at = new Date(T0.getTime() + 600_000);
    const [late] = g.drain({ duplicate: true });
    expect(() => verifyFake('whsec', late?.rawBody ?? '', late?.headers[FAKE_SIGNATURE_HEADER], clock.at)).not.toThrow();
    await g.deactivate(id);
    expect(() => g.pay(id)).toThrow('inactive');
    g.pay(id, { race: true });
    g.refund(p, 50, 'GBP');
    const kinds = await Promise.all(g.drain({ reverse: true }).map(async (d) => (await g.handleWebhook(d.rawBody, d.headers))[0]?.type));
    expect(kinds).toEqual(['payment_reversed', 'payment_confirmed']);
  });

  it('fails creates and status checks on demand; unknown types yield nothing', async () => {
    const clock = clockAt(T0);
    const g = new FakeGateway({ secret: 'whsec', clock });
    g.failNextCreates(1);
    await expect(g.createPaymentRequest({ invoiceId: 'i', amountMinor: 1, reference: REF })).rejects.toThrow('unavailable');
    g.failNextStatus(1);
    await expect(g.getStatus('x')).rejects.toThrow('unavailable');
    const body = JSON.stringify({ id: 'e', type: 'account.updated', created: 1, livemode: false, data: {} });
    expect(await g.handleWebhook(body, { [FAKE_SIGNATURE_HEADER]: signFake('whsec', body, T0) })).toEqual([]);
  });
});
