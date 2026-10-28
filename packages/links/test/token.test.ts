import { describe, expect, it } from 'vitest';
import { checkBaseUrl, hashToken, looksLikeToken, newToken, sameDigest, urlFor } from '../src/index.ts';

describe('public link tokens (issue A)', () => {
  it('are 43 base64url characters from 32 random bytes, and differ every time', () => {
    const a = newToken();
    const b = newToken();
    expect(looksLikeToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
  });

  it('carry nothing: the same bytes give the same token, and the token says nothing about tenant or invoice', () => {
    const fixed = () => new Uint8Array(32).fill(7);
    expect(newToken(fixed)).toBe(newToken(fixed));
    expect(newToken(fixed)).not.toMatch(/-[0-9a-f]{4}-/); // not a uuid, not a JWT (no dots)
    expect(newToken(fixed)).not.toContain('.');
  });

  it('are stored only as sha256 hex, compared in constant time', () => {
    const t = newToken();
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sameDigest(h, hashToken(t))).toBe(true);
    expect(sameDigest(h, hashToken(newToken()))).toBe(false);
    expect(sameDigest(h, 'abcd')).toBe(false);
  });

  it('junk never looks like a token', () => {
    for (const bad of ['', 'x', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, '../../etc/passwd', null, 42]) expect(looksLikeToken(bad)).toBe(false);
  });

  it('URLs are built only from a clean configured base', () => {
    expect(checkBaseUrl('https://pay.example.com/')).toBe('https://pay.example.com');
    expect(checkBaseUrl('http://localhost:3100')).toBe('http://localhost:3100');
    for (const bad of [undefined, '', 'ftp://x', 'https://u:p@x.com', 'https://x.com/?a=1', 'javascript:alert(1)', 'not a url']) expect(checkBaseUrl(bad)).toBeNull();
    expect(urlFor('https://x.com', 'pay', 'T')).toBe('https://x.com/p/T');
    expect(urlFor('https://x.com', 'opt_out', 'T')).toBe('https://x.com/o/T');
  });
});
