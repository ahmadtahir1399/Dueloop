// Pipeline steps 1-2 for provider webhooks: the opaque per-account token in the path finds the account (its
// sha256 is what we store), the provider verifies the signature over the RAW body, and only then is anything
// parsed or stored. Unverified requests are rejected and never stored (rule 23). Stored events are queued in
// the same statement; processing happens elsewhere (ack fast, process later).
import { createHash } from 'node:crypto';
import type { PaymentsDeps } from './ports.ts';

export type IngestResult =
  | { readonly status: 200; readonly stored: number; readonly duplicates: number; readonly ignored: number }
  | { readonly status: 400 | 401 | 404 | 503; readonly reason: string };

export function webhookTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export async function ingestPaymentWebhook(deps: PaymentsDeps, token: string, rawBody: string, headers: Readonly<Record<string, string>>): Promise<IngestResult> {
  if (!TOKEN.test(token)) return { status: 404, reason: 'unknown_endpoint' };
  const account = await deps.db.accountByTokenHash(webhookTokenHash(token));
  if (!account) return { status: 404, reason: 'unknown_endpoint' };
  const gw = await deps.providers.forAccount(account);
  if (!gw) return { status: 503, reason: 'provider_unavailable' };

  let events;
  try {
    events = await gw.handleWebhook(rawBody, headers);
  } catch {
    deps.logger.warn('payment_webhook_rejected', { tenantId: account.tenantId, reason: 'signature' });
    return { status: 401, reason: 'signature' };
  }
  // Mode must match the account (issue G/O): a test event never touches a live account, and vice versa.
  if (events.some((e) => e.livemode !== undefined && e.livemode !== (account.mode === 'live'))) {
    deps.logger.warn('payment_webhook_rejected', { tenantId: account.tenantId, reason: 'mode_mismatch' });
    return { status: 400, reason: 'mode_mismatch' };
  }
  if (events.some((e) => !e.providerEventId)) return { status: 400, reason: 'missing_event_id' };

  const raw = JSON.parse(rawBody) as Record<string, unknown>; // verified above
  let stored = 0;
  let duplicates = 0;
  const now = deps.clock.now();
  for (const e of events) {
    const id = await deps.db.store(account.id, account.provider, { ...e, providerEventId: e.providerEventId as string }, raw, now);
    if (id === null) duplicates++;
    else stored++;
  }
  deps.logger.info('payment_webhook_stored', { tenantId: account.tenantId, count: stored, duplicates });
  return { status: 200, stored, duplicates, ignored: events.length === 0 ? 1 : 0 };
}
