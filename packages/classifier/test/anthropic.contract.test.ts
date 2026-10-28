// The Claude adapter through the real SDK with an injected fetch (no network): response shapes follow the
// Messages API (content blocks, stop_reason, usage); errors use the API's error envelope.
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicReplyClassifier, buildClassifierInput, toProposal } from '../src/index.ts';

const input = buildClassifierInput({ text: "Can't pay until the 15th", reference: new Date('2026-10-20T10:00:00Z'), timezone: 'Europe/London', currency: 'GBP', localeHint: 'en', redaction: { names: [], invoiceNumbers: [] } });
const analysis = { intent: 'promise_to_pay', confidence: 0.9, promisedDate: '2026-11-15', promisedDateText: 'the 15th', dateIsVague: false, statedAmountText: null, language: 'en', summary: 'Will pay on the 15th.' };

function fakeClient(respond: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    // Like real fetch, honour the abort signal the SDK uses for its timeout.
    return Promise.race([
      respond(body),
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    ]);
  }) as typeof globalThis.fetch;
  return { client: new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 }), bodies };
}
const message = (text: string, stop = 'end_turn') =>
  new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 812, output_tokens: 64 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const apiError = (status: number, type: string) => new Response(JSON.stringify({ type: 'error', error: { type, message: 'x' } }), { status, headers: { 'content-type': 'application/json' } });

const make = (client: Anthropic, over: Partial<ConstructorParameters<typeof AnthropicReplyClassifier>[0]> = {}) =>
  new AnthropicReplyClassifier({ model: 'claude-opus-5-5', timeoutMs: 200, maxRetries: 0, effort: 'low', fallbacks: true, nowMs: () => 0, client, ...over });

describe('AnthropicReplyClassifier', () => {
  it('sends the configured model, structured output and the delimited prompt; returns raw output and usage', async () => {
    const { client, bodies } = fakeClient(() => message(JSON.stringify(analysis)));
    const r = await make(client).classify(input);
    expect(r).toMatchObject({ ok: true, raw: analysis, modelId: 'claude-opus-5-5', promptVersion: 'reply-v1', tokensIn: 812, tokensOut: 64 });
    expect(r.ok && toProposal(r.raw).kind).toBe('proposal');
    const body = bodies[0] ?? {};
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect((body.output_config as { effort: string; format: { type: string } }).effort).toBe('low');
    expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    const prompt = JSON.stringify(body.messages);
    expect(prompt).toContain("<<<MESSAGE\\nCan't pay until the 15th\\nMESSAGE>>>");
  });

  it('refusal or truncated output => raw null (toProposal sends it to a human)', async () => {
    for (const stop of ['refusal', 'max_tokens']) {
      const { client } = fakeClient(() => message('{"intent":', stop));
      const r = await make(client).classify(input);
      expect(r).toMatchObject({ ok: true, raw: null });
      expect(r.ok && toProposal(r.raw)).toMatchObject({ kind: 'review', reason: 'invalid_output' });
    }
  });

  it('non-JSON text => raw null', async () => {
    const { client } = fakeClient(() => message('Sure! The intent is promise.'));
    expect(await make(client).classify(input)).toMatchObject({ ok: true, raw: null });
  });

  it.each<[number, string, string]>([
    [429, 'rate_limit_error', 'rate_limited'],
    [500, 'api_error', 'unavailable'],
    [529, 'overloaded_error', 'unavailable'],
    [401, 'authentication_error', 'unavailable'],
  ])('HTTP %i => %s outage (the event retries; the message is never lost)', async (status, type, error) => {
    const { client } = fakeClient(() => apiError(status, type));
    expect(await make(client).classify(input)).toEqual({ ok: false, error });
  });

  it('timeout => timeout outage', async () => {
    const { client } = fakeClient(() => new Promise<Response>(() => undefined));
    expect(await make(client, { timeoutMs: 50 }).classify(input)).toEqual({ ok: false, error: 'timeout' });
  });

  it('no model configured => refuses to start (never a hard-coded default)', () => {
    expect(() => make(new Anthropic({ apiKey: 'k' }), { model: '' })).toThrow(/CLASSIFIER_MODEL/);
  });
});
