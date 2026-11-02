// SSRF guard for mail servers a business chooses (SMTP and IMAP): the worker would otherwise connect to internal
// services on a tenant's say-so.
import { lookup } from 'node:dns/promises';

/** Loopback, private, link-local, CGNAT, unspecified and multicast addresses (IPv4, IPv6, IPv4-mapped IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v);
}

/**
 * Resolve once and refuse if ANY address is internal. The caller connects to the returned address (no second
 * lookup that DNS rebinding could change) and keeps the host name for the TLS certificate check.
 */
export async function pinnedAddress(host: string, allowed: (ip: string) => boolean = (ip) => !isPrivateAddress(ip)): Promise<string | null> {
  const addresses = await lookup(host, { all: true }).catch(() => []);
  const first = addresses[0];
  return first && addresses.every((a) => allowed(a.address)) ? first.address : null;
}
