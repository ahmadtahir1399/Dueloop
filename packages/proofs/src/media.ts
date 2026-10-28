// Getting the bytes of attachment N of an inbound message (step 13b). Email: re-parse the raw message we stored
// (prompt 4 kept it until purge). WhatsApp: the Cloud API media endpoints (developers.facebook.com/docs/whatsapp/
// cloud-api/reference/media, fetched 2026-10-28): GET /<version>/<MEDIA_ID> returns a URL valid for 5 minutes;
// GET that URL with the same Bearer token returns the bytes; media ids from webhooks expire after 7 days. So we
// fetch at processing time, promptly, authenticated, and never store the URL.
import PostalMime from 'postal-mime';
import { PROOF_LIMITS } from './sniff.ts';

export interface ProofMessage {
  readonly tenantId: string;
  readonly messageId: string;
  readonly channel: 'email' | 'whatsapp' | 'sms';
  readonly customerId: string | null;
  readonly attachments: readonly { readonly name: string | null; readonly mime: string; readonly size: number }[];
  readonly rawMime: string | null;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly invoiceIds: readonly string[];
}

export type Fetched = { readonly ok: true; readonly bytes: Buffer } | { readonly ok: false; readonly reason: 'unavailable' | 'too_large' | 'not_found' };

export interface MediaFetcher {
  fetch(m: ProofMessage, index: number): Promise<Fetched>;
}

// Same filter as the inbound normaliser, so attachment indexes line up with messages.attachments.
const NOT_ATTACHMENTS = ['message/delivery-status', 'message/global-delivery-status', 'text/rfc822-headers'];

export async function emailAttachment(rawMime: string, index: number): Promise<Fetched> {
  const email = await PostalMime.parse(rawMime, { rfc822Attachments: true, maxNestingDepth: 20, maxPartCount: 200, maxHeadersSize: 256 * 1024 });
  const list = email.attachments.filter((a) => !NOT_ATTACHMENTS.includes(a.mimeType));
  const a = list[index];
  if (!a) return { ok: false, reason: 'not_found' };
  const c = a.content;
  const bytes = typeof c === 'string' ? Buffer.from(c, 'utf8') : c instanceof Uint8Array ? Buffer.from(c) : Buffer.from(new Uint8Array(c));
  return bytes.length > PROOF_LIMITS.maxBytes ? { ok: false, reason: 'too_large' } : { ok: true, bytes };
}

/** The media id of attachment N, from the stored (verified) WhatsApp message item; same order as the normaliser. */
export function whatsappMediaId(payload: Readonly<Record<string, unknown>> | null, index: number): string | null {
  if (!payload) return null;
  const ids = ['image', 'document', 'audio', 'video', 'sticker'].flatMap((t) => {
    const v = payload[t] as Record<string, unknown> | undefined;
    return v && typeof v === 'object' ? [typeof v.id === 'string' ? v.id : ''] : [];
  });
  const id = ids[index] ?? '';
  return /^[A-Za-z0-9_.-]{1,200}$/.test(id) ? id : null;
}

export interface MediaOptions {
  readonly graphVersion: string;
  /** The tenant's WhatsApp access token (Vault, via the channel secret). */
  readonly tokenFor: (tenantId: string) => Promise<string | null>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

export function createMediaFetcher(o: MediaOptions): MediaFetcher {
  const f = o.fetch ?? fetch;
  const timeout = () => AbortSignal.timeout(o.timeoutMs ?? 15_000);
  return {
    async fetch(m, index) {
      if (m.channel === 'email') return m.rawMime ? emailAttachment(m.rawMime, index) : { ok: false, reason: 'unavailable' }; // purged
      if (m.channel !== 'whatsapp' || !o.graphVersion) return { ok: false, reason: 'unavailable' };
      const id = whatsappMediaId(m.payload, index);
      const token = await o.tokenFor(m.tenantId);
      if (!id || !token) return { ok: false, reason: 'unavailable' };
      const auth = { Authorization: `Bearer ${token}` };
      const meta = await f(`${o.baseUrl ?? 'https://graph.facebook.com'}/${o.graphVersion}/${encodeURIComponent(id)}`, { headers: auth, signal: timeout() });
      if (meta.status === 404) return { ok: false, reason: 'not_found' };
      if (!meta.ok) return { ok: false, reason: 'unavailable' };
      const info = (await meta.json().catch(() => ({}))) as { url?: unknown; file_size?: unknown };
      if (typeof info.url !== 'string' || !info.url.startsWith('https://')) return { ok: false, reason: 'unavailable' };
      if (Number(info.file_size) > PROOF_LIMITS.maxBytes) return { ok: false, reason: 'too_large' };
      const res = await f(info.url, { headers: auth, signal: timeout() });
      if (!res.ok) return { ok: false, reason: res.status === 404 ? 'not_found' : 'unavailable' };
      if (Number(res.headers.get('content-length') ?? 0) > PROOF_LIMITS.maxBytes) return { ok: false, reason: 'too_large' };
      const bytes = Buffer.from(await res.arrayBuffer());
      return bytes.length > PROOF_LIMITS.maxBytes ? { ok: false, reason: 'too_large' } : { ok: true, bytes };
    },
  };
}
