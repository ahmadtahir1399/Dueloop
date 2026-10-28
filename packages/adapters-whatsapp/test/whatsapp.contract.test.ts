import { describe, expect, it } from 'vitest';
import type { OutboundEnvelope } from '@dueloop/messaging';
import { buildTemplateRequest, classifyGraphError, createWhatsAppChannel } from '../src/index.ts';

const envelope: OutboundEnvelope = {
  tenantId: 't',
  idempotencyKey: 'inv-1:s2:whatsapp',
  account: { phone_number_id: '106540352242922' },
  content: {
    kind: 'whatsapp_template',
    to: '+447700900123',
    templateName: 'payment_reminder',
    languageCode: 'en_US',
    parameters: [
      { name: 'customer_name', text: 'Ada' },
      { name: 'invoice_number', text: 'INV-1' },
    ],
  },
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fake(respond: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  }) as typeof fetch;
  return { f, calls };
}
const channelWith = (f: typeof fetch, timeoutMs = 200) => createWhatsAppChannel({ graphVersion: 'v99.0', timeoutMs, fetch: f });

describe('WhatsApp adapter contract', () => {
  it('builds a template message with named body parameters', () => {
    expect(buildTemplateRequest(envelope)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+447700900123',
      type: 'template',
      template: {
        name: 'payment_reminder',
        language: { code: 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', parameter_name: 'customer_name', text: 'Ada' },
              { type: 'text', parameter_name: 'invoice_number', text: 'INV-1' },
            ],
          },
        ],
      },
    });
  });

  it('200 with messages[0].id -> sent with the wamid; correct URL and bearer header', async () => {
    const { f, calls } = fake(async () => json(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] }));
    expect(await channelWith(f).send(envelope, 'tok')).toEqual({ kind: 'sent', providerMessageId: 'wamid.ABC' });
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v99.0/106540352242922/messages');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it.each<[number, unknown, string, string]>([
    [400, { error: { code: 131026 } }, 'permanent', 'wa_131026'],
    [400, { error: { code: 132001 } }, 'permanent', 'wa_132001'],
    [401, { error: { code: 190 } }, 'permanent', 'wa_190'],
    [400, { error: { code: 130429 } }, 'not_sent_retryable', 'wa_130429'],
    [400, { error: { code: 131056 } }, 'not_sent_retryable', 'wa_131056'],
    [503, { error: { code: 131016 } }, 'not_sent_retryable', 'wa_131016'],
    [500, { error: { code: 131000 } }, 'ambiguous', 'wa_131000'],
    [500, { error: { code: 1 } }, 'ambiguous', 'wa_1'],
    [429, {}, 'not_sent_retryable', 'wa_http_429'],
    [502, 'not json', 'ambiguous', 'wa_http_502'],
    [400, { error: { code: 999999 } }, 'permanent', 'wa_999999'],
  ])('HTTP %i %j -> %s', async (status, body, kind, reason) => {
    const { f } = fake(async () => (typeof body === 'string' ? new Response(body, { status }) : json(status, body)));
    expect(await channelWith(f).send(envelope, 'tok')).toEqual({ kind, reason });
  });

  it('200 without a message id -> ambiguous', async () => {
    const { f } = fake(async () => json(200, {}));
    expect(await channelWith(f).send(envelope, 'tok')).toEqual({ kind: 'ambiguous', reason: 'wa_no_message_id' });
  });

  it('timeout -> ambiguous (never retried)', async () => {
    const { f } = fake(
      (_u, init) =>
        new Promise((_r, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    expect(await channelWith(f, 50).send(envelope, 'tok')).toEqual({ kind: 'ambiguous', reason: 'wa_timeout' });
  });

  it('DNS failure / refused -> not sent; reset mid-request -> ambiguous', async () => {
    const err = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });
    expect(await channelWith(fake(async () => Promise.reject(err('ENOTFOUND'))).f).send(envelope, 'tok')).toEqual({ kind: 'not_sent_retryable', reason: 'wa_enotfound' });
    expect(await channelWith(fake(async () => Promise.reject(err('ECONNREFUSED'))).f).send(envelope, 'tok')).toMatchObject({ kind: 'not_sent_retryable' });
    expect(await channelWith(fake(async () => Promise.reject(err('ECONNRESET'))).f).send(envelope, 'tok')).toEqual({ kind: 'ambiguous', reason: 'wa_network' });
  });

  it('missing account / token -> not sent, no request made', async () => {
    const { f, calls } = fake(async () => json(200, {}));
    expect(await channelWith(f).send({ ...envelope, account: {} }, 'tok')).toMatchObject({ kind: 'not_sent_retryable', reason: 'wa_not_configured' });
    expect(await channelWith(f).send({ ...envelope, account: { phone_number_id: '1/../x' } }, 'tok')).toMatchObject({ reason: 'wa_not_configured' });
    expect(await channelWith(f).send(envelope, null)).toMatchObject({ reason: 'wa_no_token' });
    expect(calls).toHaveLength(0);
  });

  it('the token never appears in an outcome (rule 19)', async () => {
    const { f } = fake(async () => json(401, { error: { code: 190, message: 'Invalid token tok-SECRET' } }));
    expect(JSON.stringify(await channelWith(f).send(envelope, 'tok-SECRET'))).not.toContain('SECRET');
    expect(classifyGraphError(400, null)).toEqual({ kind: 'permanent', reason: 'wa_http_400' });
  });
});
