// Public link tokens (ADR 0045, issue A): 32 random bytes, base64url (43 chars). Opaque: they carry no tenant,
// invoice or expiry; the database row (looked up by sha256 of the token) holds all of that and can be revoked.
// Pure except for the injected random source.

export const TOKEN_BYTES = 32;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Days a link stays valid. A pay link outlives a typical reminder cycle; an opt-out link must keep working long. */
export const PAY_LINK_TTL_DAYS = 60;
export const OPT_OUT_LINK_TTL_DAYS = 365;

export type Purpose = 'pay' | 'opt_out';

export function encodeToken(bytes: Uint8Array): string {
  if (bytes.length !== TOKEN_BYTES) throw new Error('a token needs 32 random bytes');
  return Buffer.from(bytes).toString('base64url');
}

/** Shape check before any lookup (cheap rejection of junk; NOT a validity check). */
export function looksLikeToken(t: unknown): t is string {
  return typeof t === 'string' && TOKEN.test(t);
}

/** The base URL from config: absolute http(s), no credentials, no query or fragment. Returns it without a trailing slash. */
export function checkBaseUrl(base: string | undefined): string | null {
  if (!base) return null;
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.search || u.hash) return null;
  return u.href.replace(/\/+$/, '');
}

export const pathFor = (purpose: Purpose, token: string) => `/${purpose === 'pay' ? 'p' : 'o'}/${token}`;
export const urlFor = (base: string, purpose: Purpose, token: string) => `${base}${pathFor(purpose, token)}`;
