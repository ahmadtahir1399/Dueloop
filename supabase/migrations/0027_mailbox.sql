-- Reading customer email replies (ADR 0054): the production IMAP poller (`pnpm mailbox`). A business connects the
-- mailbox its customers reply to.
--
-- Connection settings live in imap_config, not in config: config is client-writable (0026), so an owner could PATCH
-- imap_host through the API and have the poller send the stored password to any server, which would make a
-- write-only secret readable. imap_config and imap_secret_id have no client write grant (0026 grants by column);
-- only private.set_mailbox writes them, and it asks for the password again when the login target changes.
--
-- The password is a Vault secret of its own: the email channel's secret_id is the SMTP password, and smtpLogin
-- prefers it over the operator's SMTP_PASSWORD, so sharing it would break sending on the operator's relay.
alter table public.channel_accounts
  add column imap_config jsonb check (imap_config is null or jsonb_typeof(imap_config) = 'object'),
  add column imap_secret_id uuid;

-- Poll status per mailbox. A row with uid_validity null has not been read yet (first poll: baseline only).
alter table private.imap_cursors
  add column last_ok_at timestamptz,
  add column last_error text check (last_error in ('host_refused', 'login_failed', 'connect_failed', 'mailbox_not_found', 'poll_failed')),
  add column failures integer not null default 0 check (failures >= 0),
  add column next_attempt_at timestamptz;

alter table private.service_heartbeats drop constraint service_heartbeats_service_check;
alter table private.service_heartbeats add constraint service_heartbeats_service_check
  check (service in ('web', 'worker', 'processor', 'webhooks', 'payments', 'mailbox'));

create function private.set_mailbox(p_tenant_id uuid, p_config jsonb, p_password text, p_reply_to text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  acc public.channel_accounts%rowtype;
  same_login boolean;
begin
  if not private.is_trusted_caller() then
    raise exception using errcode = '42501', message = 'mailboxes can only be set by trusted server code';
  end if;
  insert into public.channel_accounts (tenant_id, channel) values (p_tenant_id, 'email') on conflict (tenant_id, channel) do nothing;
  select * into acc from public.channel_accounts where tenant_id = p_tenant_id and channel = 'email' for update;
  -- The stored password only ever goes to the server it was saved for.
  same_login := acc.imap_secret_id is not null
    and acc.imap_config ->> 'host' is not distinct from p_config ->> 'host'
    and acc.imap_config ->> 'user' is not distinct from p_config ->> 'user';
  if not same_login and p_password is null then
    raise exception using errcode = '22023', message = 'a new mailbox needs its password';
  end if;
  if p_password is not null then
    if acc.imap_secret_id is null then
      update public.channel_accounts set imap_secret_id = vault.create_secret(p_password, format('dueloop:%s:imap', p_tenant_id), 'mailbox credential') where id = acc.id;
    else
      perform vault.update_secret(acc.imap_secret_id, p_password);
    end if;
  end if;
  update public.channel_accounts
    set imap_config = p_config,
        config = case when p_reply_to is null then config - 'reply_to' else config || jsonb_build_object('reply_to', p_reply_to) end
    where id = acc.id;
  if acc.imap_config is distinct from p_config then
    -- Another mailbox or folder: the old UIDs mean nothing there, so the next poll takes a new baseline.
    delete from private.imap_cursors where channel_account_id = acc.id;
  else
    -- Same mailbox (probably a new password): try again now instead of waiting out the backoff.
    update private.imap_cursors set next_attempt_at = null where channel_account_id = acc.id;
  end if;
end $$;
revoke all on function private.set_mailbox(uuid, jsonb, text, text) from public, anon, authenticated, service_role;

create function private.mailbox_password(p_tenant_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret
  from public.channel_accounts a join vault.decrypted_secrets s on s.id = a.imap_secret_id
  where a.tenant_id = p_tenant_id and a.channel = 'email'
$$;
revoke all on function private.mailbox_password(uuid) from public, anon, authenticated, service_role;

create function private.disconnect_mailbox(p_tenant_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  acc public.channel_accounts%rowtype;
begin
  if not private.is_trusted_caller() then
    raise exception using errcode = '42501', message = 'mailboxes can only be changed by trusted server code';
  end if;
  select * into acc from public.channel_accounts where tenant_id = p_tenant_id and channel = 'email' for update;
  if not found or acc.imap_config is null then return false; end if;
  update public.channel_accounts set imap_config = null, imap_secret_id = null, config = config - 'reply_to' where id = acc.id;
  delete from private.imap_cursors where channel_account_id = acc.id;
  delete from vault.secrets where id = acc.imap_secret_id;
  return true;
end $$;
revoke all on function private.disconnect_mailbox(uuid) from public, anon, authenticated, service_role;
