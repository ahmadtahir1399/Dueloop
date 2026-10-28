-- Prompt 4 step 10: the read-only IMAP poller's cursor per mailbox (UIDVALIDITY + highest UID seen).
-- Private schema: never exposed through the Data API; only the poller (trusted connection) touches it.
create table private.imap_cursors (
  channel_account_id uuid primary key references public.channel_accounts (id) on delete cascade,
  mailbox text not null default 'INBOX' check (length(mailbox) between 1 and 200),
  uid_validity text,
  last_uid bigint not null default 0 check (last_uid >= 0),
  updated_at timestamptz not null default now()
);
revoke all on table private.imap_cursors from public, anon, authenticated, service_role;
