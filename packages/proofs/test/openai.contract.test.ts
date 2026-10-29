// The OpenAI proof extractor through the real SDK with an injected fetch (no network). Shapes follow the
// Responses API typings in openai 7.45.1.
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { OpenAIProofExtractor, parseHints } from '../src/extract.ts';

const hints = { amountText: '£120.00', dateText: '2026-10-20', referenceText: null, bankNameText: 'Example Bank' };

function fakeClient(respond: () => Response) {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return respond();
  }) as typeof globalThis.fetch;
  return { client: new OpenAI({ apiKey: 'test-key', fetch, maxRetries: 0 }), bodies };
}
const response = (content: unknown[], status = 'completed') =>
  new Response(
    JSON.stringify({
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      model: 'test-vision-2026',
      status,
      incomplete_details: status === 'completed' ? null : { reason: 'content_filter' },
      output: [{ id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content }],
      usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 0 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 940 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const make = (client: OpenAI) => new OpenAIProofExtractor({ model: 'test-vision-2026', timeoutMs: 200, maxRetries: 0, client });

describe('OpenAIProofExtractor', () => {
  it('sends the image as a data URL with the strict format and store:false; returns raw hints for code to parse', async () => {
    const { client, bodies } = fakeClient(() => response([{ type: 'output_text', text: JSON.stringify(hints), annotations: [] }]));
    const r = await make(client).extract(image, 'image/png');
    expect(r).toEqual({ ok: true, raw: hints, modelId: 'test-vision-2026', promptVersion: 'proof-v1' });
    expect(r.ok && parseHints(r.raw, { currency: 'GBP', referenceCode: 'X' })?.amountMinor).toBe(12000);
    const body = bodies[0] ?? {};
    expect(body.store).toBe(false);
    expect(body.text).toMatchObject({ format: { type: 'json_schema', strict: true, name: 'proof_hints' } });
    expect(JSON.stringify(body.text)).not.toMatch(/maxLength/);
    const content = (body.input as { content: { type: string; image_url?: string }[] }[])[0]?.content ?? [];
    expect(content[0]).toMatchObject({ type: 'input_image', image_url: `data:image/png;base64,${image.toString('base64')}` });
    expect(content[1]?.type).toBe('input_text');
  });

  it('refusal or an incomplete answer => no hints', async () => {
    for (const res of [() => response([{ type: 'refusal', refusal: 'no' }]), () => response([{ type: 'output_text', text: '{"amountText":', annotations: [] }], 'incomplete')]) {
      const { client } = fakeClient(res);
      expect(await make(client).extract(image, 'image/png')).toMatchObject({ ok: true, raw: null });
    }
  });

  it('API error => outage, never hints', async () => {
    const { client } = fakeClient(() => new Response(JSON.stringify({ error: { type: 'server_error', message: 'x', code: null, param: null } }), { status: 500, headers: { 'content-type': 'application/json' } }));
    expect(await make(client).extract(image, 'image/png')).toEqual({ ok: false, error: 'unavailable' });
  });

  it('no model configured => refuses to start', () => {
    expect(() => new OpenAIProofExtractor({ model: '', timeoutMs: 1, maxRetries: 0, client: new OpenAI({ apiKey: 'k' }) })).toThrow(/PROOF_EXTRACTION_MODEL/);
  });
});
