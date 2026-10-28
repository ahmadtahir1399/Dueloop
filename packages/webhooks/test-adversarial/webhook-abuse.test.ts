// (d) Webhook abuse against the REAL store: bad/missing signature, replay, oversize body, wrong content type,
// unknown account => rejected or ignored, nothing stored as trusted, no stack traces in responses.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, q, quietCron, replyWorld } from '../../inbound/test-db/harness.ts';
import { DEFAULT_WEBHOOK_CONFIG, createWebhookServer, pgWebhookStore, signMeta } from '../src/index.ts';

const SECRET = 'adversarial-secret';
let base = '';
let phoneId = '';
let tenantId = '';
const server = createWebhookServer({
  store: pgWebhookStore(pool),
  config: { ...DEFAULT_WEBHOOK_CONFIG, appSecret: SECRET, verifyToken: 'tok', maxBodyBytes: 64 * 1024, rateBurst: 1000 },
  now: () => new Date('2026-10-20T10:00:00Z'),
  log: () => undefined,
});

beforeAll(async () => {
  await quietCron();
  const w = await replyWorld();
  tenantId = w.tenantId;
  phoneId = (await q<{ external_account_id: string }>('select external_account_id from public.channel_accounts where id = $1', [w.waAccountId]))[0]?.external_account_id ?? '';
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

const payload = (pid: string, wamid: string) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'W', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: pid }, messages: [{ from: '447700900123', id: wamid, timestamp: '1760950000', type: 'text', text: { body: 'STOP' } }] } }] }],
  });
const stored = async () => (await q('select 1 from public.inbound_events where tenant_id = $1', [tenantId])).length;
const post = async (body: string, headers: Record<string, string>) => {
  const r = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', body, headers });
  const text = await r.text();
  expect(text).not.toMatch(/Error|\bat .+\(|stack|node:/); // never a stack trace or internals
  expect(text.length).toBeLessThan(40);
  return r.status;
};

describe('(d) webhook abuse', () => {
  it('a correctly signed delivery is stored (control)', async () => {
    const before = await stored();
    const body = payload(phoneId, 'wamid.ok1');
    expect(await post(body, { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signMeta(body, SECRET) })).toBe(200);
    expect(await stored()).toBe(before + 1);
  });

  type Headers = (body: string) => Record<string, string>;
  const json = 'application/json';
  const rejected: [string, Headers, number][] = [
    ['missing signature', () => ({ 'Content-Type': json }), 401],
    ['bad signature', () => ({ 'Content-Type': json, 'X-Hub-Signature-256': signMeta('other', SECRET) }), 401],
    ['signed with another secret', (b) => ({ 'Content-Type': json, 'X-Hub-Signature-256': signMeta(b, 'attacker') }), 401],
    ['malformed hex signature', (b) => ({ 'Content-Type': json, 'X-Hub-Signature-256': `${signMeta(b, SECRET)}zz` }), 401],
    ['wrong content type', (b) => ({ 'Content-Type': 'text/plain', 'X-Hub-Signature-256': signMeta(b, SECRET) }), 415],
  ];
  it.each(rejected)('%s => rejected, nothing stored', async (_n, headers, status) => {
    const before = await stored();
    const body = payload(phoneId, `wamid.${Math.random()}`);
    expect(await post(body, headers(body))).toBe(status);
    expect(await stored()).toBe(before);
  });

  it('oversize body => 413 before anything is read into the store', async () => {
    const before = await stored();
    const big = JSON.stringify({ pad: 'x'.repeat(100 * 1024) });
    expect(await post(big, { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signMeta(big, SECRET) })).toBe(413);
    expect(await stored()).toBe(before);
  });

  it('replay of a valid delivery => 200, nothing new stored (provider event id dedupe)', async () => {
    const body = payload(phoneId, 'wamid.replay');
    const h = { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signMeta(body, SECRET) };
    await post(body, h);
    const before = await stored();
    for (let i = 0; i < 3; i++) expect(await post(body, h)).toBe(200);
    expect(await stored()).toBe(before);
  });

  it('a signed delivery for an unknown account => 200 (Meta must not retry), nothing stored for anyone', async () => {
    const total = async () => (await q('select 1 from public.inbound_events')).length;
    const before = await total();
    const body = payload('999000999000', 'wamid.unknown');
    expect(await post(body, { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signMeta(body, SECRET) })).toBe(200);
    expect(await total()).toBe(before);
  });

  it('no tenant ids in URLs: any other path is 404', async () => {
    expect((await fetch(`${base}/webhooks/whatsapp/${tenantId}`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}/webhooks/${tenantId}`, { method: 'POST' })).status).toBe(404);
  });
});
