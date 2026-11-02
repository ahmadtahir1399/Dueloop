// ImapStore over Postgres: the cursor lives in private.imap_cursors; raw messages go through the same
// private.store_inbound_event as webhooks (tenant from the channel account, dedupe, queue, purge_after).
import type pg from 'pg';
import type { ImapSettings, ImapStore, MailboxFailure } from './imap.ts';

export interface MailboxAccount {
  readonly id: string;
  readonly tenantId: string;
  readonly settings: ImapSettings;
  readonly password: string;
}

export interface MailboxStore extends ImapStore {
  /** Connected mailboxes whose backoff has passed. */
  dueAccounts(now: Date, tenantId: string | null): Promise<MailboxAccount[]>;
  recordOk(accountId: string, mailbox: string, at: Date): Promise<void>;
  /** Returns how many polls in a row have failed. */
  recordFailure(accountId: string, mailbox: string, code: MailboxFailure, at: Date): Promise<number>;
}

export function pgImapStore(pool: pg.Pool): MailboxStore {
  return {
    async cursor(accountId) {
      const r = await pool.query<{ uid_validity: string | null; last_uid: string; updated_at: Date }>('select uid_validity, last_uid, updated_at from private.imap_cursors where channel_account_id = $1', [accountId]);
      const x = r.rows[0];
      return x ? { uidValidity: x.uid_validity, lastUid: Number(x.last_uid), savedAt: x.updated_at } : { uidValidity: null, lastUid: 0, savedAt: null };
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
    async relevant(accountId, from, threadIds) {
      const r = await pool.query<{ hit: boolean }>(
        `select exists (select 1 from public.customers c where c.tenant_id = a.tenant_id and lower(c.email) = $2)
             or exists (select 1 from public.messages m where m.tenant_id = a.tenant_id and m.direction = 'out' and (m.rfc_message_id = any($3::text[]) or m.provider_message_id = any($3::text[]))) as hit
         from public.channel_accounts a where a.id = $1`,
        [accountId, from, threadIds],
      );
      return r.rows[0]?.hit === true;
    },
    async dueAccounts(now, tenantId) {
      const r = await pool.query<{ id: string; tenant_id: string; imap_config: Record<string, unknown>; password: string | null }>(
        `select a.id, a.tenant_id, a.imap_config, private.mailbox_password(a.tenant_id) as password
         from public.channel_accounts a left join private.imap_cursors c on c.channel_account_id = a.id
         where a.channel = 'email' and a.enabled and a.imap_config is not null and a.imap_secret_id is not null
           and (c.next_attempt_at is null or c.next_attempt_at <= $1) and ($2::uuid is null or a.tenant_id = $2)
         order by c.last_ok_at nulls first`,
        [now, tenantId],
      );
      return r.rows.flatMap((x) => {
        const c = x.imap_config;
        if (typeof c.host !== 'string' || typeof c.user !== 'string' || typeof c.port !== 'number' || !x.password) return [];
        return [{ id: x.id, tenantId: x.tenant_id, password: x.password, settings: { host: c.host, port: c.port, secure: c.port === 993, user: c.user, mailbox: typeof c.mailbox === 'string' ? c.mailbox : 'INBOX' } }];
      });
    },
    async recordOk(accountId, mailbox, at) {
      await pool.query(
        `insert into private.imap_cursors (channel_account_id, mailbox, last_ok_at) values ($1, $2, $3)
         on conflict (channel_account_id) do update set last_ok_at = excluded.last_ok_at, last_error = null, failures = 0, next_attempt_at = null`,
        [accountId, mailbox, at],
      );
    },
    async recordFailure(accountId, mailbox, code, at) {
      // Backoff doubles from 2 minutes to an hour: repeated bad logins get accounts locked by mail providers.
      const r = await pool.query<{ failures: number }>(
        `insert into private.imap_cursors (channel_account_id, mailbox, last_error, failures, next_attempt_at) values ($1, $2, $3, 1, $4::timestamptz + interval '2 minutes')
         on conflict (channel_account_id) do update
           set last_error = excluded.last_error, failures = private.imap_cursors.failures + 1,
               next_attempt_at = $4::timestamptz + make_interval(secs => least(3600, 60 * 2 ^ least(private.imap_cursors.failures + 1, 12)))
         returning failures`,
        [accountId, mailbox, code, at],
      );
      return r.rows[0]?.failures ?? 1;
    },
  };
}
