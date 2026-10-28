// The payment block (prompt 5, step 6a): composed by code, never by a template author or a provider. It always
// carries the CURRENT balance and the reference code; a gateway link is added only when it passes safePayLink.
// Bank text is the tenant's own setting.

const MAX_LINK = 500;
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** A provider URL we are willing to put in a message: https, a plain host, no credentials, no odd characters. */
export function safePayLink(url: string | null | undefined): string | null {
  if (!url || url.length > MAX_LINK || /[\s<>"'`\\]/.test(url)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !HOST.test(u.hostname)) return null;
  return u.href;
}

export interface PaymentBlockInput {
  /** Formatted by formatAmount in the template's locale. */
  readonly amountDue: string;
  readonly referenceCode: string;
  readonly bankText: string;
  /** Already checked with safePayLink (null = none). */
  readonly link: string | null;
}

export function paymentBlock(i: PaymentBlockInput): string {
  const lines: string[] = [];
  if (i.link) lines.push(`Pay ${i.amountDue} online: ${i.link}`, '');
  lines.push(`To pay ${i.amountDue} by bank transfer, please quote ${i.referenceCode}.`);
  const bank = i.bankText.trim();
  if (bank) lines.push(bank);
  return lines.join('\n');
}
