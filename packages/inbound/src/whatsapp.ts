// WhatsApp Cloud API webhook payloads (shapes from Meta's docs: webhooks/reference/messages/text and
// webhooks/reference/messages/status, read 2026-10-28). One POST can carry several messages and statuses;
// the webhook service splits it into one stored event per item, keyed by provider event id (issue I).
import type { DeliveryStatus, NormaliseError, NormalisedMessage, NormalisedStatus } from './types.ts';

export interface WhatsAppItem {
  /** metadata.phone_number_id: identifies OUR channel account (never trusted for the tenant on its own). */
  readonly phoneNumberId: string;
  readonly kind: 'message' | 'status';
  /** Dedupe key: the wamid for messages; wamid + status for statuses (each status is its own event). */
  readonly providerEventId: string;
  readonly item: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** Splits a VERIFIED webhook body into items. Anything not matching the documented shape is ignored. */
export function splitWhatsAppWebhook(body: unknown): WhatsAppItem[] {
  if (!isObj(body) || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return [];
  const out: WhatsAppItem[] = [];
  for (const entry of body.entry) {
    if (!isObj(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isObj(change) || change.field !== 'messages' || !isObj(change.value)) continue;
      const value = change.value;
      const phoneNumberId = isObj(value.metadata) ? str(value.metadata.phone_number_id) : null;
      if (!phoneNumberId) continue;
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        const id = isObj(m) ? str(m.id) : null;
        if (isObj(m) && id) out.push({ phoneNumberId, kind: 'message', providerEventId: id, item: m });
      }
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        const id = isObj(s) ? str(s.id) : null;
        const status = isObj(s) ? str(s.status) : null;
        if (isObj(s) && id && status) out.push({ phoneNumberId, kind: 'status', providerEventId: `${id}:${status}`, item: s });
      }
    }
  }
  return out;
}

const unix = (v: unknown): Date | null => {
  const n = typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null;
  return n === null ? null : new Date(n * 1000);
};

const STATUSES: Record<string, DeliveryStatus> = { sent: 'sent', delivered: 'delivered', read: 'read', played: 'read', failed: 'failed' };

export function normaliseWhatsApp(kind: 'message' | 'status', item: Record<string, unknown>): { ok: true; value: NormalisedMessage | NormalisedStatus } | { ok: false; error: NormaliseError } {
  if (kind === 'status') {
    const id = str(item.id);
    const status = STATUSES[str(item.status) ?? ''];
    if (!id || !status) return { ok: false, error: 'unsupported' };
    const err = Array.isArray(item.errors) && isObj(item.errors[0]) ? item.errors[0].code : null;
    return {
      ok: true,
      value: {
        kind: 'status',
        channel: 'whatsapp',
        providerMessageId: id,
        status,
        timestamp: unix(item.timestamp),
        errorCode: typeof err === 'number' ? err : null,
        bizOpaque: str(item.biz_opaque_callback_data),
      },
    };
  }
  const id = str(item.id);
  const from = str(item.from);
  if (!id || !from || !/^\d{6,15}$/.test(from)) return { ok: false, error: 'unparseable' };
  // Only text bodies are understood in this phase; other types are stored and become a human task.
  const text = item.type === 'text' && isObj(item.text) ? (str(item.text.body) ?? '') : '';
  const contextId = isObj(item.context) ? str(item.context.id) : null;
  const attachments = ['image', 'document', 'audio', 'video', 'sticker'].flatMap((t) => {
    const a = item[t];
    return isObj(a) ? [{ name: str(a.filename), mime: str(a.mime_type) ?? `application/x-whatsapp-${t}`, size: 0 }] : [];
  });
  return {
    ok: true,
    value: {
      kind: 'message',
      channel: 'whatsapp',
      providerMessageId: id,
      from,
      toAddresses: [],
      providerTimestamp: unix(item.timestamp),
      inReplyTo: contextId,
      references: [],
      subject: null,
      fullText: text,
      newText: text.trim(),
      attachments,
      autoSubmitted: null,
      precedence: null,
      autoReplyHeader: false,
      report: null,
    },
  };
}
