// Email normalisation (pipeline step 3): size cap BEFORE parsing, MIME via postal-mime, HTML -> text via
// html-to-text (never rendered), quoted history stripped by a documented heuristic, attachments as metadata.
import { convert } from 'html-to-text';
import PostalMime, { type Address, type Email } from 'postal-mime';
import type { AttachmentMeta, DeliveryReport, NormaliseError, NormalisedMessage } from './types.ts';

/** Raw messages above this are not parsed at all (they are kept raw and become a task). */
export const MAX_EMAIL_BYTES = 2 * 1024 * 1024;
/** Fallback head when no quoted history marker is found. */
export const HEAD_FALLBACK_CHARS = 2000;

const htmlToText = (html: string) =>
  convert(html, {
    wordwrap: false,
    limits: { maxInputLength: 1_000_000 },
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'style', format: 'skip' },
      { selector: 'script', format: 'skip' },
    ],
  });

/**
 * Quoted-history heuristic (documented in ADR 0024): cut at the first line that starts a quote block —
 * an attribution line ("On ... wrote:", "Am ... schrieb ...:", "El ... escribió:", "Le ... a écrit :"),
 * an Outlook header block ("-----Original Message-----", "From: " after a blank line, "________"),
 * or the first run of ">"-quoted lines. Then drop a trailing "-- " signature.
 */
const QUOTE_START = [
  /^On .{3,200}wrote:\s*$/i,
  /^Am .{3,200}schrieb .{0,200}:\s*$/i,
  /^El .{3,200}escribi[oó]:\s*$/i,
  /^Le .{3,200}a [ée]crit\s*:\s*$/i,
  /^-{2,}\s*(Original Message|Ursprüngliche Nachricht|Mensaje original)\s*-{2,}\s*$/i,
  /^_{8,}\s*$/,
  /^>/,
];

export function stripQuoted(text: string): { text: string; stripped: boolean } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (QUOTE_START.some((re) => re.test(l.trim()))) {
      cut = i;
      break;
    }
    // Outlook: "From: name" header block after a blank line.
    if (/^From:\s/i.test(l) && i > 0 && (lines[i - 1] ?? '').trim() === '' && /^(Sent|Date|Gesendet|Enviado):\s/i.test(lines[i + 1] ?? '')) {
      cut = i;
      break;
    }
  }
  let kept = cut >= 0 ? lines.slice(0, cut) : lines;
  const sig = kept.findIndex((l) => l === '-- ');
  if (sig >= 0) kept = kept.slice(0, sig);
  const out = kept.join('\n').trim();
  if (cut >= 0 && out !== '') return { text: out, stripped: true };
  return { text: text.trim().slice(0, HEAD_FALLBACK_CHARS), stripped: false };
}

const header = (headers: readonly { key: string; value: string }[], key: string) => headers.find((h) => h.key === key)?.value ?? null;

function addresses(list: readonly Address[] | undefined): string[] {
  const out: string[] = [];
  for (const a of list ?? []) {
    if (a.address) out.push(a.address.toLowerCase());
    for (const m of a.group ?? []) out.push(m.address.toLowerCase());
  }
  return out;
}

const textOf = (c: ArrayBuffer | Uint8Array | string) => (typeof c === 'string' ? c : new TextDecoder().decode(c));

/** RFC 3464: multipart/report; report-type=delivery-status with a message/delivery-status part. */
function deliveryReport(email: Email): DeliveryReport | null {
  const ct = (header(email.headers, 'content-type') ?? '').toLowerCase();
  const dsn = email.attachments.find((a) => a.mimeType === 'message/delivery-status' || a.mimeType === 'message/global-delivery-status');
  if (!dsn && !(ct.startsWith('multipart/report') && ct.includes('delivery-status'))) return null;
  const body = dsn ? textOf(dsn.content) : '';
  const action = /^\s*Action:\s*([a-z]+)/im.exec(body)?.[1]?.toLowerCase() ?? null;
  const status = /^\s*Status:\s*([245]\.\d{1,3}\.\d{1,3})/im.exec(body)?.[1] ?? null;
  const returned = email.attachments.find((a) => a.mimeType === 'message/rfc822' || a.mimeType === 'text/rfc822-headers');
  const originalMessageId = returned ? (/^Message-ID:\s*(<[^>\s]{3,500}>)/im.exec(textOf(returned.content))?.[1] ?? null) : null;
  const known = ['failed', 'delayed', 'delivered', 'relayed', 'expanded'] as const;
  return { action: known.find((k) => k === action) ?? null, status, originalMessageId };
}

const byteLength = (raw: string | Uint8Array) => (typeof raw === 'string' ? new TextEncoder().encode(raw).length : raw.byteLength);

export async function normaliseEmail(raw: string | Uint8Array): Promise<{ ok: true; message: NormalisedMessage } | { ok: false; error: NormaliseError }> {
  if (byteLength(raw) > MAX_EMAIL_BYTES) return { ok: false, error: 'too_large' };
  let email: Email;
  try {
    email = await PostalMime.parse(raw, { rfc822Attachments: true, attachmentEncoding: 'utf8', maxNestingDepth: 20, maxPartCount: 200, maxHeadersSize: 256 * 1024 });
  } catch {
    return { ok: false, error: 'unparseable' };
  }
  const from = email.from?.address?.toLowerCase() ?? (email.from?.group?.[0]?.address?.toLowerCase() ?? '');
  const messageId = email.messageId?.trim() ?? '';
  if (!messageId || !from) return { ok: false, error: 'unparseable' };
  const fullText = (email.text && email.text.trim() !== '' ? email.text : email.html ? htmlToText(email.html) : '').replace(/\r\n/g, '\n');
  const date = email.date ? new Date(email.date) : null;
  const refs = (email.references ?? '').match(/<[^<>\s]{3,500}>/g) ?? [];
  const attachments: AttachmentMeta[] = email.attachments
    .filter((a) => !['message/delivery-status', 'message/global-delivery-status', 'text/rfc822-headers'].includes(a.mimeType))
    .map((a) => ({ name: a.filename, mime: a.mimeType, size: typeof a.content === 'string' ? a.content.length : a.content.byteLength }));
  const autoReplyHeader = email.headers.some((h) => ['x-autoreply', 'x-autorespond', 'x-auto-response-suppress'].includes(h.key) && h.value.trim() !== '');
  return {
    ok: true,
    message: {
      kind: 'message',
      channel: 'email',
      providerMessageId: messageId,
      from,
      toAddresses: [...addresses(email.to), ...addresses(email.cc)],
      providerTimestamp: date && !Number.isNaN(date.getTime()) ? date : null,
      inReplyTo: /<[^<>\s]{3,500}>/.exec(email.inReplyTo ?? '')?.[0] ?? null,
      references: refs,
      subject: email.subject ?? null,
      fullText,
      newText: stripQuoted(fullText).text,
      attachments,
      autoSubmitted: header(email.headers, 'auto-submitted')?.trim().toLowerCase() ?? null,
      precedence: header(email.headers, 'precedence')?.trim().toLowerCase() ?? null,
      autoReplyHeader,
      report: deliveryReport(email),
    },
  };
}
