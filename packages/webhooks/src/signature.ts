// Meta webhook signature (webhooks/create-webhook-endpoint, read 2026-10-28):
//   X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw request body, keyed with the app secret>
// Lives here, not in core (issue A): it needs node:crypto, and core imports only luxon.
import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER = /^sha256=([0-9a-f]{64})$/i;

/**
 * Verifies over the RAW bytes, before anything is parsed (rule 23). The header format is checked strictly
 * first: Buffer.from(hex) never throws on malformed input (it silently stops at the first bad character),
 * so a try/catch around it cannot reject anything, and "<valid 64 hex>zz" would decode to the right length.
 */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || appSecret === '') return false;
  const m = HEADER.exec(header.trim());
  if (!m?.[1]) return false;
  const given = Buffer.from(m[1], 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Timing-safe comparison for the GET handshake's verify token. */
export function tokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** For tests and the gated smoke script: the header Meta would send for `rawBody`. */
export function signMeta(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}
