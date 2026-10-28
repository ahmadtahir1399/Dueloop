// Contract tests for the WhatsApp webhook endpoint. Payload fixtures are built from Meta's webhook reference
// (messages/text, messages/status) and signed exactly as create-webhook-endpoint describes.
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebhookServer, DEFAULT_WEBHOOK_CONFIG, signMeta, verifyMetaSignature, type WebhookStore } from '../src/index.ts';

const SECRET = 'test-app-secret';
const TOKEN = 'verify-me';

export const metaTextPayload = (phoneNumberId: string, wamid = 'wamid.IN1', body = 'Will pay Friday') => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA_ID',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550001111', phone_number_id: phoneNumberId },
            contacts: [{ profile: { name: 'Imran' }, wa_id: '923001234567' }],
            messages: [{ from: '923001234567', id: wamid, timestamp: '1760950000', type: 'text', text: { body } }],
          },
        },
      ],
    },
  ],
});

function memoryStore(accounts: Record<string, string>) {
  const events = new Map<string, { kind: string; payload: unknown }>();
  const store: WebhookStore = {
    accountFor: async (_c, id) => accounts[id] ?? null,
    store: async (account, _p, eventId, kind, payload) => {
      const key = `${account}:${eventId}`;
      if (events.has(key)) return null;
      events.set(key, { kind, payload });
      return events.size;
    },
  };
  return { store, events };
}

const servers: ReturnType<typeof createWebhookServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(store: WebhookStore, over: Partial<typeof DEFAULT_WEBHOOK_CONFIG> = {}) {
  const logs: string[] = [];
  const server = createWebhookServer({ store, config: { ...DEFAULT_WEBHOOK_CONFIG, appSecret: SECRET, verifyToken: TOKEN, ...over }, now: () => new Date('2026-10-20T10:00:00Z'), log: (e, f) => logs.push(`${e} ${JSON.stringify(f)}`) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, logs };
}

const post = (base: string, body: string, headers: Record<string, string>) => fetch(`${base}/webhooks/whatsapp`, { method: 'POST', body, headers });

describe('signature (issue A)', () => {
  const raw = Buffer.from('{"a":1}');
  const good = signMeta(raw, SECRET);
  it('accepts the exact signature over the raw bytes', () => {
    expect(verifyMetaSignature(raw, good, SECRET)).toBe(true);
  });
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['wrong prefix', good.replace('sha256=', 'sha1=')],
    ['malformed hex (Buffer.from would silently decode it)', `${good.slice(0, -2)}zz`],
    ['valid signature plus junk (same decoded length)', `${good}zz`],
    ['odd length', good.slice(0, -1)],
    ['another secret', signMeta(raw, 'other')],
    ['a tampered body', signMeta(Buffer.from('{"a":2}'), SECRET)],
  ])('rejects %s', (_n, header) => {
    expect(verifyMetaSignature(raw, header, SECRET)).toBe(false);
  });
  it('an empty secret never verifies anything', () => {
    expect(verifyMetaSignature(raw, signMeta(raw, ''), '')).toBe(false);
  });
});

describe('WhatsApp webhook endpoint', () => {
  it('GET handshake: echoes hub.challenge only for the right token', async () => {
    const { base } = await start(memoryStore({}).store);
    const ok = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${TOKEN}&hub.challenge=1158201444`);
    expect([ok.status, await ok.text()]).toEqual([200, '1158201444']);
    const bad = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
    expect(bad.status).toBe(403);
  });

  it('a signed POST stores one event per message, tenant from the channel account; 200 fast', async () => {
    const m = memoryStore({ '106540352242922': 'acct-1' });
    const { base } = await start(m.store);
    const body = JSON.stringify(metaTextPayload('106540352242922'));
    const r = await post(base, body, { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signMeta(body, SECRET) });
    expect(r.status).toBe(200);
    expect([...m.events.keys()]).toEqual(['acct-1:wamid.IN1']);
  });

  it('health endpoint; no tenant ids in any route', async () => {
    const { base } = await start(memoryStore({}).store);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/webhooks/whatsapp/00000000-0000-0000-0000-00000000000a`, { method: 'POST' })).status).toBe(404);
  });
});
