import "server-only";
import type { TenantContext } from "@/lib/session";
import { trustedPool } from "@/lib/trusted/db";

export interface MailboxStatus {
  lastOkAt: Date | null;
  lastError: string | null;
}

/**
 * What the poller last saw, for the active tenant only (private schema, so the trusted pool). Codes only: the mail
 * server's own words never reach this table.
 */
export async function mailboxStatus(ctx: TenantContext): Promise<MailboxStatus | null> {
  const r = await trustedPool().query<{ last_ok_at: Date | null; last_error: string | null }>(
    "select c.last_ok_at, c.last_error from private.imap_cursors c join public.channel_accounts a on a.id = c.channel_account_id where a.tenant_id = $1 and a.channel = 'email'",
    [ctx.tenant.id],
  );
  const x = r.rows[0];
  return x ? { lastOkAt: x.last_ok_at, lastError: x.last_error } : null;
}
