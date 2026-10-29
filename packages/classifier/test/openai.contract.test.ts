// The OpenAI adapter through the real SDK with an injected fetch (no network): response shapes follow the
// Responses API typings in openai 7.45.1 (output messages, status, incomplete_details, usage); errors use the
// API's error envelope.
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { OpenAIReplyClassifier, buildClassifierInput, toProposal } from '../src/index.ts';

const input = buildClassifierInput({ text: "Can't pay until the 15th", reference: new Date('2026-10-20T10:00:00Z'), timezone: 'Europe/London', currency: 'GBP', localeHint: 'en', redaction: { names: [], invoiceNumbers: [] } });
const analysis = { intent: 'promise_to_pay', confidence: 0.9, promisedDate: '2026-11-15', promisedDateText: 'the 15th', dateIsVague: false, statedAmountText: null, language: 'en', summary: 'Will pay on the 15th.' };

function fakeClient(respond: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return Promise.race([
      respond(body),
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    ]);
  }) as typeof globalThis.fetch;
  return { client: new OpenAI({ apiKey: 'test-key', fetch, maxRetries: 0 }), bodies };
}
type Content = { type: 'output_text'; text: string; annotations: [] } | { type: 'refusal'; refusal: string };
const response = (content: Content[], status = 'completed', incomplete: { reason: string } | null = null) =>
  new Response(
    JSON.stringify({
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      model: 'test-model-2026',
      status,
      incomplete_details: incomplete,
      output: [{ id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content }],
      usage: { input_tokens: 812, input_tokens_details: { cached_tokens: 0 }, output_tokens: 64, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 876 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
const text = (t: string): Content => ({ type: 'output_text', text: t, annotations: [] });
const apiError = (status: number, type: string) => new Response(JSON.stringify({ error: { type, message: 'x', code: null, param: null } }), { status, headers: { 'content-type': 'application/json' } });

const make = (client: OpenAI, over: Partial<ConstructorParameters<typeof OpenAIReplyClassifier>[0]> = {}) =>
  new OpenAIReplyClassifier({ model: 'test-model-2026', timeoutMs: 200, maxRetries: 0, nowMs: () => 0, client, ...over });

describe('OpenAIReplyClassifier', () => {
  it('sends the configured model, a strict json_schema format, store:false and the delimited prompt', async () => {
    const { client, bodies } = fakeClient(() => response([text(JSON.stringify(analysis))]));
    const r = await make(client).classify(input);
    expect(r).toMatchObject({ ok: true, raw: analysis, modelId: 'test-model-2026', promptVersion: 'reply-v1', tokensIn: 812, tokensOut: 64 });
    expect(r.ok && toProposal(r.raw).kind).toBe('proposal');
    const body = bodies[0] ?? {};
    expect(body.model).toBe('test-model-2026');
    expect(body.store).toBe(false);
    const format = (body.text as { format: { type: string; strict: boolean; name: string } }).format;
    expect(format).toMatchObject({ type: 'json_schema', strict: true, name: 'reply_analysis' });
    // Only keywords the Structured Outputs guide lists; lengths are re-checked by toProposal.
    expect(JSON.stringify(format)).not.toMatch(/minLength|maxLength/);
    expect(JSON.stringify(format)).toContain('"pattern"');
    expect(JSON.stringify(body.input)).toContain("<<<MESSAGE\\nCan't pay until the 15th\\nMESSAGE>>>");
  });

  it('refusal or incomplete output => raw null (toProposal sends it to a human)', async () => {
    for (const res of [() => response([{ type: 'refusal', refusal: 'no' }]), () => response([text('{"intent":')], 'incomplete', { reason: 'max_output_tokens' })]) {
      const { client } = fakeClient(res);
      const r = await make(client).classify(input);
      expect(r).toMatchObject({ ok: true, raw: null });
      expect(r.ok && toProposal(r.raw)).toMatchObject({ kind: 'review', reason: 'invalid_output' });
    }
  });

  it('non-JSON text => raw null', async () => {
    const { client } = fakeClient(() => response([text('Sure! The intent is promise.')]));
    expect(await make(client).classify(input)).toMatchObject({ ok: true, raw: null });
  });

  it.each<[number, string, string]>([
    [429, 'rate_limit_exceeded', 'rate_limited'],
    [500, 'server_error', 'unavailable'],
    [503, 'server_error', 'unavailable'],
    [401, 'invalid_api_key', 'unavailable'],
  ])('HTTP %i => %s outage (the event retries; the message is never lost)', async (status, type, error) => {
    const { client } = fakeClient(() => apiError(status, type));
    expect(await make(client).classify(input)).toEqual({ ok: false, error });
  });

  it('timeout => timeout outage', async () => {
    const { client } = fakeClient(() => new Promise<Response>(() => undefined));
    expect(await make(client, { timeoutMs: 50 }).classify(input)).toEqual({ ok: false, error: 'timeout' });
  });

  it('reasoning effort is sent only when configured (models without reasoning reject the field)', async () => {
    const plain = fakeClient(() => response([text(JSON.stringify(analysis))]));
    await make(plain.client).classify(input);
    expect(plain.bodies[0]).not.toHaveProperty('reasoning');
    const reasoning = fakeClient(() => response([text(JSON.stringify(analysis))]));
    await make(reasoning.client, { reasoningEffort: 'low' }).classify(input);
    expect(reasoning.bodies[0]?.reasoning).toEqual({ effort: 'low' });
  });

  it('the default client logs nothing, whatever OPENAI_LOG says (it could print customer text)', () => {
    const saved = process.env.OPENAI_LOG;
    const savedKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_LOG = 'debug';
    process.env.OPENAI_API_KEY = 'test-key'; // read by the SDK; nothing is called
    try {
      const c = new OpenAIReplyClassifier({ model: 'm', timeoutMs: 1, maxRetries: 0, nowMs: () => 0, client: undefined as never });
      expect((c as unknown as { client: { logLevel: string } }).client.logLevel).toBe('off');
    } finally {
      if (saved === undefined) delete process.env.OPENAI_LOG;
      else process.env.OPENAI_LOG = saved;
      if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = savedKey;
    }
  });

  it('no model configured => refuses to start (never a hard-coded default)', () => {
    expect(() => make(new OpenAI({ apiKey: 'k' }), { model: '' })).toThrow(/CLASSIFIER_MODEL/);
  });
});
