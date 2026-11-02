// Resend adapter: POST https://api.resend.com/emails over HTTPS (docs read 2026-11-01), for hosts that block mail
// ports. Plain text only. The operator's key from the environment, never a tenant secret. Every failure is
// classified into a SendOutcome: if Resend MAY have taken the message, the outcome is ambiguous (rule 17). Our
// idempotency key goes in Idempotency-Key, but Resend keeps it for 24 hours only, so it does not make a retry safe.
// Message-ID is not sent: Resend documents custom headers but not this one, and it sets its own.
import type { OutboundChannel, OutboundEnvelope, SendOutcome } from '@dueloop/messaging';
import { senderAllowed } from './sender.ts';

export interface ResendChannelOptions {
  readonly apiKey: string;
  /** Kept below the worker's hard timeout, so most hangs are classified here first. */
  readonly timeoutMs: number;
  /** SMTP_FROM_DOMAINS: sender domains this account may send for. Empty = no limit. */
  readonly allowedFromDomains?: readonly string[];
  /** Injected for tests; defaults to global fetch. */
  readonly fetch?: typeof fetch;
}

/** Errno codes Node/undici raise only when no connection was made: the request never left. */
const NEVER_CONNECTED = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

/**
 * Non-2xx answers, from Resend's error table. 400 and 422: the same request fails again. 401, 403 (bad key, domain
 * not verified), 404, 405 and 429 (rate limit, quota): refused, and the message can go once that is fixed. 409 means
 * this idempotency key is in flight or already used, and 5xx may be half-processed, so both are ambiguous. The reason
 * is a status code, never Resend's text (it can echo addresses: rule 20).
 */
export function classifyResendStatus(status: number): SendOutcome {
  const reason = `resend_${status}`;
  if (status === 400 || status === 422) return { kind: 'permanent', reason };
  if (status === 409 || status < 400 || status >= 500) return { kind: 'ambiguous', reason };
  return { kind: 'not_sent_retryable', reason };
}

function causeCode(e: unknown): string | null {
  const c = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof c === 'string' ? c : null;
}

/** A display name is business-supplied text: drop what could end the quoted string or start a new header. */
function fromHeader(from: { readonly address: string; readonly name: string }): string {
  const name = from.name.replace(/[\p{Cc}"\\<>]/gu, ' ').trim();
  return name === '' ? from.address : `"${name}" <${from.address}>`;
}

export function buildResendRequest(envelope: OutboundEnvelope): Record<string, unknown> | null {
  const mail = envelope.content;
  if (mail.kind !== 'email') return null;
  return {
    from: fromHeader(mail.from),
    to: [mail.to.address],
    subject: mail.subject,
    text: mail.text,
    // RFC 8058 one-click unsubscribe, the same two headers the SMTP adapter sends.
    ...(mail.listUnsubscribe ? { headers: { 'List-Unsubscribe': `<${mail.listUnsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
  };
}

export function createResendChannel(options: ResendChannelOptions): OutboundChannel {
  const doFetch = options.fetch ?? fetch;
  const limits = { allowedFromDomains: options.allowedFromDomains ?? [] };
  return {
    channel: 'email',
    async send(envelope): Promise<SendOutcome> {
      const body = buildResendRequest(envelope);
      if (!body || envelope.content.kind !== 'email') return { kind: 'permanent', reason: 'wrong_content_kind' };
      if (!senderAllowed(envelope.content.from.address, limits)) return { kind: 'not_sent_retryable', reason: 'resend_sender_not_allowed' };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs);
      let res: Response;
      try {
        res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': envelope.idempotencyKey },
          body: JSON.stringify(body),
          redirect: 'manual',
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        const code = causeCode(e);
        if (code && NEVER_CONNECTED.has(code)) return { kind: 'not_sent_retryable', reason: `resend_${code.toLowerCase()}` };
        return { kind: 'ambiguous', reason: ctrl.signal.aborted ? 'resend_timeout' : 'resend_network' };
      }
      const json: unknown = await res.json().catch(() => null);
      clearTimeout(timer);
      if (res.ok) {
        const id = (json as { id?: unknown } | null)?.id;
        // 2xx without an id: Resend took the request but we cannot prove what happened.
        return typeof id === 'string' && id !== '' ? { kind: 'sent', providerMessageId: id } : { kind: 'ambiguous', reason: 'resend_no_message_id' };
      }
      return classifyResendStatus(res.status);
    },
  };
}
