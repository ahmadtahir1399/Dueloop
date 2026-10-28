// WebhookStore over Postgres (direct trusted connection, like the worker and the processor).
import type pg from 'pg';
import type { WebhookStore } from './server.ts';

export function pgWebhookStore(pool: pg.Pool): WebhookStore {
  return {
    async accountFor(channel, externalAccountId) {
      const r = await pool.query<{ id: string }>('select id from public.channel_accounts where channel = $1 and external_account_id = $2 and enabled', [channel, externalAccountId]);
      return r.rows[0]?.id ?? null;
    },
    async store(accountId, provider, providerEventId, kind, payload, receivedAt) {
      const r = await pool.query<{ id: string | null }>('select private.store_inbound_event($1, $2, $3, $4, $5, null, $6) as id', [
        accountId,
        provider,
        providerEventId.slice(0, 500),
        kind,
        JSON.stringify(payload),
        receivedAt,
      ]);
      const id = r.rows[0]?.id ?? null;
      return id === null ? null : Number(id);
    },
  };
}
