// Contract test against a scripted fetch: every way a Resend call can end maps to exactly one SendOutcome, and
// "Resend may have the message" is always ambiguous (rule 17).
import { describe, expect, it } from 'vitest';
import type { OutboundEnvelope } from '@dueloop/messaging';
import { buildResendRequest, classifyResendStatus, createResendChannel, emailChannelFromEnv, fromDomainsFromEnv } from '../src/index.ts';

const API_KEY = 're_test_not_a_real_key';

const envelope: OutboundEnvelope = {
  tenantId: 't',
  idempotencyKey: 'inv-1:s1:email',
  account: {},
  content: {
    kind: 'email',
    to: { address: 'ada@customer.example', name: 'Ada' },
    from: { address: 'billing@test-co.example', name: 'Test Co' },
    subject: 'Reminder INV-1',
    text: 'Hi Ada,\n\n--\nReply STOP',
    messageId: '<inv-1.s1.email.dueloop@test-co.example>',
  },
};

function scripted(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, channel: createResendChannel({ apiKey: API_KEY, timeoutMs: 50, fetch: doFetch }) };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>;

describe('Resend adapter contract', () => {
  it('200 with an id -> sent, posted to the Resend API with our idempotency key', async () => {
    const s = scripted(() => json(200, { id: 'resend-1' }));
    expect(await s.channel.send(envelope, null)).toEqual({ kind: 'sent', providerMessageId: 'resend-1' });
    const call = s.calls[0];
    expect(call?.url).toBe('https://api.resend.com/emails');
    expect(call?.init.method).toBe('POST');
    expect(new Headers(call?.init.headers).get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(new Headers(call?.init.headers).get('idempotency-key')).toBe('inv-1:s1:email');
    expect(bodyOf(call?.init ?? {})).toEqual({
      from: '"Test Co" <billing@test-co.example>',
      to: ['ada@customer.example'],
      subject: 'Reminder INV-1',
      text: 'Hi Ada,\n\n--\nReply STOP',
    });
  });

  it('adds the RFC 8058 one-click unsubscribe headers when the message has a link', async () => {
    const s = scripted(() => json(200, { id: 'resend-1' }));
    const content = { ...envelope.content, listUnsubscribe: 'https://app.example/o/tok/unsubscribe' } as OutboundEnvelope['content'];
    await s.channel.send({ ...envelope, content }, null);
    expect(bodyOf(s.calls[0]?.init ?? {}).headers).toEqual({
      'List-Unsubscribe': '<https://app.example/o/tok/unsubscribe>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('sends the reply address when the message has one, and leaves it out otherwise', () => {
    const content = { ...envelope.content, replyTo: 'replies@test-co.example' } as OutboundEnvelope['content'];
    expect(buildResendRequest({ ...envelope, content })?.reply_to).toBe('replies@test-co.example');
    expect(buildResendRequest(envelope)).not.toHaveProperty('reply_to');
  });

  it('a hostile sender name cannot break out of the from header', async () => {
    const s = scripted(() => json(200, { id: 'resend-1' }));
    const mail = envelope.content as Extract<OutboundEnvelope['content'], { kind: 'email' }>;
    const content = { ...mail, from: { ...mail.from, name: 'Bad" <evil@x.example>\r\nBcc: a@b.example' } };
    await s.channel.send({ ...envelope, content }, null);
    expect(bodyOf(s.calls[0]?.init ?? {}).from).toBe('"Bad   evil@x.example   Bcc: a@b.example" <billing@test-co.example>');
  });

  it('an empty sender name sends the bare address', async () => {
    const s = scripted(() => json(200, { id: 'resend-1' }));
    const mail = envelope.content as Extract<OutboundEnvelope['content'], { kind: 'email' }>;
    await s.channel.send({ ...envelope, content: { ...mail, from: { ...mail.from, name: ' ' } } }, null);
    expect(bodyOf(s.calls[0]?.init ?? {}).from).toBe('billing@test-co.example');
  });

  it('200 without an id -> ambiguous: Resend took the request but we cannot prove what happened', async () => {
    expect(await scripted(() => json(200, {})).channel.send(envelope, null)).toEqual({ kind: 'ambiguous', reason: 'resend_no_message_id' });
    expect(await scripted(() => new Response('not json', { status: 200 })).channel.send(envelope, null)).toEqual({ kind: 'ambiguous', reason: 'resend_no_message_id' });
  });

  it.each<[number, string]>([
    [400, 'permanent'], // validation_error: the same request fails again
    [401, 'not_sent_retryable'], // bad key: fix the key, the message can still go
    [403, 'not_sent_retryable'], // domain not verified: same
    [404, 'not_sent_retryable'],
    [409, 'ambiguous'], // the same key is in flight or already used: the first attempt may have gone out
    [422, 'permanent'], // missing or invalid field
    [429, 'not_sent_retryable'], // rate limit or quota
    [500, 'ambiguous'],
    [503, 'ambiguous'],
    [302, 'ambiguous'], // never expected: not proof of anything
  ])('HTTP %i -> %s', async (status, kind) => {
    expect(classifyResendStatus(status)).toEqual({ kind, reason: `resend_${status}` });
    expect(await scripted(() => json(status, { name: 'x', message: 'ada@customer.example is bad' })).channel.send(envelope, null)).toEqual({ kind, reason: `resend_${status}` });
  });

  it.each([['ECONNREFUSED'], ['ENOTFOUND'], ['EAI_AGAIN'], ['EHOSTUNREACH'], ['ENETUNREACH'], ['UND_ERR_CONNECT_TIMEOUT']])('%s -> not sent, retryable', async (code) => {
    const s = scripted(() => Promise.reject(new TypeError('fetch failed', { cause: { code } })));
    expect(await s.channel.send(envelope, null)).toEqual({ kind: 'not_sent_retryable', reason: `resend_${code.toLowerCase()}` });
  });

  it('connection lost after the request left -> ambiguous', async () => {
    const s = scripted(() => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })));
    expect(await s.channel.send(envelope, null)).toEqual({ kind: 'ambiguous', reason: 'resend_network' });
  });

  it('no answer before the timeout -> ambiguous', async () => {
    const doFetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const channel = createResendChannel({ apiKey: API_KEY, timeoutMs: 10, fetch: doFetch });
    expect(await channel.send(envelope, null)).toEqual({ kind: 'ambiguous', reason: 'resend_timeout' });
  });

  it('wrong content -> permanent, and nothing is called', async () => {
    const s = scripted(() => json(200, { id: 'resend-1' }));
    const content = { kind: 'whatsapp_template', to: '+1', templateName: 'x', languageCode: 'en', parameters: [] } as const;
    expect(await s.channel.send({ ...envelope, content }, null)).toMatchObject({ kind: 'permanent' });
    expect(s.calls).toEqual([]);
  });

  it('a sender outside SMTP_FROM_DOMAINS is refused before anything is called', async () => {
    const calls: unknown[] = [];
    const doFetch = (async (...a: unknown[]) => {
      calls.push(a);
      return json(200, { id: 'resend-1' });
    }) as unknown as typeof fetch;
    const channel = createResendChannel({ apiKey: API_KEY, timeoutMs: 50, fetch: doFetch, allowedFromDomains: ['other.example'] });
    expect(await channel.send(envelope, null)).toEqual({ kind: 'not_sent_retryable', reason: 'resend_sender_not_allowed' });
    expect(calls).toEqual([]);
  });

  it('never puts the API key, the address or Resend text in an outcome', async () => {
    const outcome = await scripted(() => json(422, { message: `${API_KEY} ada@customer.example` })).channel.send(envelope, null);
    expect(JSON.stringify(outcome)).not.toContain(API_KEY);
    expect(JSON.stringify(outcome)).not.toContain('ada@customer.example');
  });
});

describe('emailChannelFromEnv', () => {
  // With no SMTP host the SMTP channel answers smtp_not_configured; the Resend channel never does.
  const noResendCall = { kind: 'not_sent_retryable', reason: 'smtp_not_configured' };

  it('uses SMTP when RESEND_API_KEY is unset or empty', async () => {
    expect(await emailChannelFromEnv({}, 50).send(envelope, null)).toEqual(noResendCall);
    expect(await emailChannelFromEnv({ RESEND_API_KEY: '' }, 50).send(envelope, null)).toEqual(noResendCall);
  });

  it('uses Resend when RESEND_API_KEY is set, and keeps SMTP_FROM_DOMAINS', async () => {
    const channel = emailChannelFromEnv({ RESEND_API_KEY: API_KEY, SMTP_FROM_DOMAINS: 'other.example' }, 50);
    expect(await channel.send(envelope, null)).toEqual({ kind: 'not_sent_retryable', reason: 'resend_sender_not_allowed' });
  });

  it('reads SMTP_FROM_DOMAINS the same way for both senders', () => {
    expect(fromDomainsFromEnv({ SMTP_FROM_DOMAINS: 'shop.example, Billing.Example ,' })).toEqual(['shop.example', 'billing.example']);
    expect(fromDomainsFromEnv({})).toEqual([]);
  });
});
