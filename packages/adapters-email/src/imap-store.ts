// ImapStore over Postgres: the cursor lives in private.imap_cursors; raw messages go through the same
// private.store_inbound_event as webhooks (tenant from the channel account, dedupe, queue, purge_after).
import type pg from 'pg';
import type { ImapStore } from './imap.ts';

export function pgImapStore(pool: pg.Pool): ImapStore {
  return {
    async cursor(accountId) {
      const r = await pool.query<{ uid_validity: string | null; last_uid: string }>('select uid_validity, last_uid from private.imap_cursors where channel_account_id = $1', [accountId]);
      const x = r.rows[0];
      return x ? { uidValidity: x.uid_validity, lastUid: Number(x.last_uid) } : { uidValidity: null, lastUid: 0 };
    },
    async saveCursor(accountId, mailbox, c) {
      await pool.query(
        `insert into private.imap_cursors (channel_account_id, mailbox, uid_validity, last_uid, updated_at) values ($1, $2, $3, $4, now())
         on conflict (channel_account_id) do update set mailbox = excluded.mailbox, uid_validity = excluded.uid_validity, last_uid = excluded.last_uid, updated_at = now()`,
        [accountId, mailbox, c.uidValidity, c.lastUid],
      );
    },
    async store(accountId, providerEventId, payload, rawMime, receivedAt) {
      const r = await pool.query<{ id: string | null }>(`select private.store_inbound_event($1, 'imap', $2, 'message', $3, $4, $5) as id`, [
        accountId,
        providerEventId.slice(0, 500),
        payload === null ? null : JSON.stringify(payload),
        rawMime,
        receivedAt,
      ]);
      const id = r.rows[0]?.id ?? null;
      return id === null ? null : Number(id);
    },
  };
}
