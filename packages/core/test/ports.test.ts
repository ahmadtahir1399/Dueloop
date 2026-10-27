// Compile-only checks: `pnpm typecheck` fails if a trivial fake stops satisfying a port.
// The runtime assertions below are incidental; the `satisfies` clauses are the test.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Channel, Locale } from '../src/domain/types.ts';
import type {
  InboundMessage,
  InvoiceSource,
  MessageChannel,
  OutboundMessage,
  PaymentProvider,
  PaymentRequest,
} from '../src/ports.ts';

const fakeChannel = {
  channel: 'email',
  async send(msg: OutboundMessage) {
    return { ok: true, providerMessageId: `fake-${msg.idempotencyKey}` };
  },
  async parseWebhook() {
    return [] as InboundMessage[];
  },
} satisfies MessageChannel;

const fakePayments = {
  name: 'bank_transfer',
  async createPaymentRequest(args: { invoiceId: string; amountMinor: number; reference: string }): Promise<PaymentRequest> {
    return { kind: 'bank_instructions', bankText: 'IBAN ...', reference: args.reference };
  },
  async handleWebhook() {
    return [];
  },
} satisfies PaymentProvider;

const fakeSource = {
  name: 'csv',
  async *pull() {
    yield { externalId: 'INV-1', raw: { amount: '12.50' } };
  },
} satisfies InvoiceSource;

describe('ports (type-level)', () => {
  it('Channel used by ports is the single domain Channel', () => {
    expectTypeOf<InboundMessage['channel']>().toEqualTypeOf<Channel>();
    expectTypeOf<MessageChannel['channel']>().toEqualTypeOf<Channel>();
  });

  it('language is a free locale string, not a hardcoded union', () => {
    expectTypeOf<OutboundMessage['language']>().toEqualTypeOf<Locale>();
    expectTypeOf<OutboundMessage['language']>().toEqualTypeOf<string>();
    const msg: OutboundMessage = {
      tenantId: 't',
      invoiceIds: ['i'],
      to: { email: 'a@example.test' },
      templateKey: 'friendly',
      language: 'pt-BR',
      variables: {},
      idempotencyKey: 'i:s1:email',
    };
    expect(msg.language).toBe('pt-BR');
  });

  it('fakes satisfy every port', async () => {
    expect((await fakeChannel.send({ tenantId: 't', invoiceIds: [], to: {}, templateKey: 'k', language: 'ur-Latn', variables: {}, idempotencyKey: 'k1' })).ok).toBe(true);
    expect((await fakePayments.createPaymentRequest({ invoiceId: 'i', amountMinor: 100, reference: 'R1' })).reference).toBe('R1');
    const pulled = [];
    for await (const row of fakeSource.pull()) pulled.push(row);
    expect(pulled).toHaveLength(1);
  });
});
