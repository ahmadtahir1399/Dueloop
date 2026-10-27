// Header sanitising (issue J): a customer name or subject containing CR/LF could inject email headers.
// Every value that ends up in a header goes through here: control characters (incl. CR, LF, NUL, U+2028/9)
// become spaces, whitespace collapses, and the result is capped.

// eslint-disable-next-line no-control-regex -- matching control characters is the whole point here
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

export function sanitiseHeaderValue(value: string, max = 200): string {
  const clean = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, max).join('');
}

/** Display names also lose characters that change address parsing. */
export function sanitiseDisplayName(name: string, max = 100): string {
  return sanitiseHeaderValue(name.replace(/[<>"\\]/g, ' '), max);
}

/** A conservative address check for headers: one address, no whitespace or control characters. */
export function isSafeAddress(address: string): boolean {
  return /^[^\s<>"(),;:\\@]+@[^\s<>"(),;:\\@]+\.[^\s<>"(),;:\\@]+$/.test(address) && address === sanitiseHeaderValue(address);
}

/** RFC 5322 Message-ID derived from the idempotency key: stable, unique per key, no PII. */
export function messageIdFor(idempotencyKey: string, domain: string): string {
  const local = idempotencyKey.replace(/[^A-Za-z0-9-]/g, '.').replace(/\.+/g, '.');
  return `<${local}.dueloop@${domain.replace(/[^A-Za-z0-9.-]/g, '')}>`;
}
