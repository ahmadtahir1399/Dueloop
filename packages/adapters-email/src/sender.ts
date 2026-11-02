// Which sender addresses the operator's mail account may use. Shared by the SMTP and Resend adapters.

/**
 * The operator account sends only for the domains in SMTP_FROM_DOMAINS (when set): otherwise any tenant owner could
 * send as any address (another tenant, a bank) through the operator's logged-in account and pass its SPF/DKIM.
 */
export function senderAllowed(fromAddress: string, limits: { readonly allowedFromDomains?: readonly string[] } | null): boolean {
  const allowed = limits?.allowedFromDomains ?? [];
  if (allowed.length === 0) return true;
  const domain = fromAddress.split('@').at(-1)?.toLowerCase() ?? '';
  return allowed.includes(domain);
}

export function fromDomainsFromEnv(env: Readonly<Record<string, string | undefined>>): string[] {
  return (env.SMTP_FROM_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== '');
}
