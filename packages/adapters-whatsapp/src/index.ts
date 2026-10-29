// WhatsApp Cloud API adapter: approved templates only (no free-form text outside the 24h window).
// POST https://graph.facebook.com/<version>/<PHONE_NUMBER_ID>/messages, Bearer token from Vault.
// The Cloud API takes no idempotency key, so anything that might have reached Meta is AMBIGUOUS (rule 17).
import type { OutboundChannel, OutboundEnvelope, SendOutcome } from '@dueloop/messaging';

export interface WhatsAppChannelOptions {
  /** Graph API version, e.g. "v23.0". Deliberately no default: set WHATSAPP_GRAPH_VERSION (ADR 0020). */
  readonly graphVersion: string;
  readonly timeoutMs: number;
  /** Injected for tests; defaults to global fetch. */
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
}

/** Throttling / temporarily unavailable: Meta rejected the request, nothing was sent. */
const RETRYABLE = new Set([4, 80007, 130429, 131056, 2, 131016]);
/**
 * Generic "unknown" / "something went wrong": Meta cannot tell us whether the message went out. Meta's guide
 * says these may be retried, but without an idempotency key a retry can double-send, so we park instead.
 */
const AMBIGUOUS = new Set([1, 131000]);
/** The same request would fail again: auth, policy, recipient, template or parameter errors. */
const PERMANENT = new Set([
  190, 368, 131031, 131005, 131008, 131009, 131021, 131026, 131042, 131047, 131048, 131049, 131051, 132000, 132001, 132005, 132007, 132012, 132015,
  132016, 133010, 135000,
]);
/** Errno codes Node/undici raise only when no connection was made: the request never left. */
const NEVER_CONNECTED = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

export function classifyGraphError(httpStatus: number, body: unknown): SendOutcome {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (typeof code === 'number') {
    if (RETRYABLE.has(code)) return { kind: 'not_sent_retryable', reason: `wa_${code}` };
    if (AMBIGUOUS.has(code)) return { kind: 'ambiguous', reason: `wa_${code}` };
    if (PERMANENT.has(code)) return { kind: 'permanent', reason: `wa_${code}` };
  }
  if (httpStatus === 429) return { kind: 'not_sent_retryable', reason: 'wa_http_429' };
  // An unrecognised 4xx is a rejected request; an unrecognised 5xx might have been half-processed.
  if (httpStatus >= 400 && httpStatus < 500) return { kind: 'permanent', reason: typeof code === 'number' ? `wa_${code}` : `wa_http_${httpStatus}` };
  return { kind: 'ambiguous', reason: typeof code === 'number' ? `wa_${code}` : `wa_http_${httpStatus}` };
}

function causeCode(e: unknown): string | null {
  const c = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof c === 'string' ? c : null;
}

export function buildTemplateRequest(envelope: OutboundEnvelope): Record<string, unknown> | null {
  const c = envelope.content;
  if (c.kind !== 'whatsapp_template') return null;
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: c.to,
    type: 'template',
    template: {
      name: c.templateName,
      language: { code: c.languageCode },
      components: c.parameters.length ? [{ type: 'body', parameters: c.parameters.map((p) => ({ type: 'text', parameter_name: p.name, text: p.text })) }] : [],
    },
  };
}

export function createWhatsAppChannel(options: WhatsAppChannelOptions): OutboundChannel {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl ?? 'https://graph.facebook.com';
  return {
    channel: 'whatsapp',
    async send(envelope, credentials): Promise<SendOutcome> {
      const body = buildTemplateRequest(envelope);
      if (!body) return { kind: 'permanent', reason: 'wrong_content_kind' };
      const phoneNumberId = envelope.account.phone_number_id;
      if (typeof phoneNumberId !== 'string' || !/^\d+$/.test(phoneNumberId)) return { kind: 'not_sent_retryable', reason: 'wa_not_configured' };
      if (!credentials) return { kind: 'not_sent_retryable', reason: 'wa_no_token' };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${base}/${encodeURIComponent(options.graphVersion)}/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${credentials}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        const code = causeCode(e);
        if (code && NEVER_CONNECTED.has(code)) return { kind: 'not_sent_retryable', reason: `wa_${code.toLowerCase()}` };
        return { kind: 'ambiguous', reason: ctrl.signal.aborted ? 'wa_timeout' : 'wa_network' };
      }
      const json: unknown = await res.json().catch(() => null);
      clearTimeout(timer);
      if (res.ok) {
        const id = (json as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
        // 2xx without a wamid: Meta took the request but we cannot prove what happened.
        return typeof id === 'string' ? { kind: 'sent', providerMessageId: id } : { kind: 'ambiguous', reason: 'wa_no_message_id' };
      }
      return classifyGraphError(res.status, json);
    },
  };
}

/**
 * Does this token have access to this phone number id? GET <base>/<version>/<PHONE_NUMBER_ID> (Meta Cloud API
 * "Phone Numbers" reference, read 2026-10-30). Used before a business may route inbound WhatsApp to itself, so it
 * cannot claim another business's number (review round 2). Never throws; the token is never logged or returned.
 */
export async function verifyPhoneNumberId(o: { graphVersion: string; token: string; phoneNumberId: string; timeoutMs: number; fetch?: typeof fetch; baseUrl?: string }): Promise<boolean> {
  if (!/^\d{1,32}$/.test(o.phoneNumberId) || !/^v\d+\.\d+$/.test(o.graphVersion) || !o.token) return false;
  const doFetch = o.fetch ?? fetch;
  try {
    const res = await doFetch(`${o.baseUrl ?? 'https://graph.facebook.com'}/${o.graphVersion}/${o.phoneNumberId}?fields=id`, {
      headers: { Authorization: `Bearer ${o.token}` },
      signal: AbortSignal.timeout(o.timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { id?: unknown };
    return body.id === o.phoneNumberId;
  } catch {
    return false;
  }
}
