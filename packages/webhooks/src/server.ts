// The single webhook runtime (ADR 0023): a minimal node:http service. Raw body first, signature second,
// parse third; tenant from the channel account (never from the URL or the payload's claims); store and
// return 2xx fast. Responses are short fixed strings: no stack traces, no echo of input.
// Prompt 5: /webhooks/payments/<opaque token>. The token only FINDS a payment account (its sha256 is stored);
// it authorises nothing: the provider signature over the raw body, with that account's secret, does.
import http from 'node:http';
import { splitWhatsAppWebhook } from '@dueloop/inbound';
import { tokensEqual, verifyMetaSignature } from './signature.ts';

export interface WebhookStore {
  /** Our channel account for a provider account id (globally unique per channel, migration 0009). */
  accountFor(channel: 'whatsapp', externalAccountId: string): Promise<string | null>;
  /** private.store_inbound_event: returns the new event id, or null when the provider event was seen before. */
  store(accountId: string, provider: 'whatsapp', providerEventId: string, kind: 'message' | 'status', payload: Record<string, unknown>, receivedAt: Date): Promise<number | null>;
}

export interface WebhookConfig {
  readonly appSecret: string;
  readonly verifyToken: string;
  /** Request bodies above this are rejected unread (413). */
  readonly maxBodyBytes: number;
  /** Per client address: a token bucket of this many requests... */
  readonly rateBurst: number;
  /** ...refilled at this rate. */
  readonly ratePerSecond: number;
}

export const DEFAULT_WEBHOOK_CONFIG: Omit<WebhookConfig, 'appSecret' | 'verifyToken'> = { maxBodyBytes: 256 * 1024, rateBurst: 60, ratePerSecond: 20 };

export interface WebhookDeps {
  readonly store: WebhookStore;
  readonly config: WebhookConfig;
  readonly now: () => Date;
  /** Ids and codes only. */
  readonly log: (event: string, fields: Readonly<Record<string, string | number>>) => void;
  /** Chaos: runs after the raw events are stored, before the 2xx is written (a crash = the provider retries). */
  readonly afterStore?: () => void | Promise<void>;
  /** Prompt 5: payment provider deliveries (verify -> store -> queue). Absent = the route does not exist. */
  readonly payments?: (token: string, rawBody: string, headers: Readonly<Record<string, string>>) => Promise<{ readonly status: number }>;
}

const PAYMENTS_PATH = /^\/webhooks\/payments\/([A-Za-z0-9_-]{1,200})$/;
const PAYMENT_REPLY: Record<number, string> = { 200: 'ok', 400: 'bad request', 401: 'unauthorized', 404: 'not found', 503: 'unavailable' };

function flatHeaders(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (typeof v === 'string') out[k.toLowerCase()] = v;
  return out;
}

type Reply = { status: number; body: string; type?: string };
const plain = (status: number, body: string): Reply => ({ status, body });

class TooLarge extends Error {}

function readRaw(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > max) return reject(new TooLarge());
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        req.destroy();
        reject(new TooLarge());
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createWebhookHandler(deps: WebhookDeps): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const allow = (key: string): boolean => {
    const now = deps.now().getTime();
    const b = buckets.get(key) ?? { tokens: deps.config.rateBurst, at: now };
    const tokens = Math.min(deps.config.rateBurst, b.tokens + ((now - b.at) / 1000) * deps.config.ratePerSecond);
    const ok = tokens >= 1;
    buckets.set(key, { tokens: ok ? tokens - 1 : tokens, at: now });
    return ok;
  };

  const handle = async (req: http.IncomingMessage): Promise<Reply> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') return { status: 200, body: '{"ok":true}', type: 'application/json' };
    const pay = PAYMENTS_PATH.exec(url.pathname);
    if (pay && deps.payments) {
      if (!allow(req.socket.remoteAddress ?? 'unknown')) return plain(429, 'slow down');
      if (req.method !== 'POST') return plain(405, 'method not allowed');
      if (!/^application\/json(\s*;|$)/i.test(req.headers['content-type'] ?? '')) return plain(415, 'unsupported media type');
      let raw: Buffer;
      try {
        raw = await readRaw(req, deps.config.maxBodyBytes);
      } catch (e) {
        return e instanceof TooLarge ? plain(413, 'too large') : plain(400, 'bad request');
      }
      const r = await deps.payments(pay[1] ?? '', raw.toString('utf8'), flatHeaders(req.headers));
      deps.log('payment_webhook', { outcome: r.status });
      return plain(r.status, PAYMENT_REPLY[r.status] ?? 'error');
    }
    // WhatsApp is served only when it is configured (an empty app secret must never verify anything).
    if (url.pathname !== '/webhooks/whatsapp' || !deps.config.appSecret) return plain(404, 'not found');
    if (!allow(req.socket.remoteAddress ?? 'unknown')) return plain(429, 'slow down');

    if (req.method === 'GET') {
      // Verification handshake: hub.mode=subscribe, hub.verify_token, hub.challenge.
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token') ?? '';
      const challenge = url.searchParams.get('hub.challenge') ?? '';
      if (mode === 'subscribe' && tokensEqual(token, deps.config.verifyToken) && /^[\w-]{1,200}$/.test(challenge)) return plain(200, challenge);
      return plain(403, 'forbidden');
    }
    if (req.method !== 'POST') return plain(405, 'method not allowed');
    if (!/^application\/json(\s*;|$)/i.test(req.headers['content-type'] ?? '')) return plain(415, 'unsupported media type');

    let raw: Buffer;
    try {
      raw = await readRaw(req, deps.config.maxBodyBytes);
    } catch (e) {
      return e instanceof TooLarge ? plain(413, 'too large') : plain(400, 'bad request');
    }
    const sig = req.headers['x-hub-signature-256'];
    if (!verifyMetaSignature(raw, Array.isArray(sig) ? undefined : sig, deps.config.appSecret)) {
      deps.log('webhook_rejected', { reason: sig ? 'bad_signature' : 'missing_signature' });
      return plain(401, 'unauthorized'); // nothing is stored
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return plain(400, 'bad request');
    }
    const items = splitWhatsAppWebhook(body);
    let stored = 0;
    let unknownAccount = 0;
    const accounts = new Map<string, string | null>();
    for (const item of items) {
      if (!accounts.has(item.phoneNumberId)) accounts.set(item.phoneNumberId, await deps.store.accountFor('whatsapp', item.phoneNumberId));
      const account = accounts.get(item.phoneNumberId) ?? null;
      if (!account) {
        unknownAccount++;
        continue;
      }
      if ((await deps.store.store(account, 'whatsapp', item.providerEventId, item.kind, item.item, deps.now())) !== null) stored++;
    }
    await deps.afterStore?.();
    deps.log('webhook_received', { count: items.length, outcome: stored, reason: unknownAccount ? `unknown_account_${unknownAccount}` : 'ok' });
    // 200 even for unknown accounts and duplicates: Meta retries non-2xx, and retrying cannot help here.
    return plain(200, 'ok');
  };

  return (req, res) => {
    handle(req)
      .catch(() => plain(500, 'error'))
      .then((r) => {
        if (res.headersSent) return;
        res.writeHead(r.status, { 'Content-Type': r.type ?? 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(r.body);
      });
  };
}

export function createWebhookServer(deps: WebhookDeps): http.Server {
  const server = http.createServer(createWebhookHandler(deps));
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  return server;
}
