-- Prompt 5, issue K: receipts share the outbox and its at-most-once rules. A stale pending receipt becomes
-- 'unknown' exactly like a reminder (never resent automatically, rule 17), but it does NOT park the invoice's
-- reminders: a receipt in doubt says nothing about whether the next reminder should go.
create or replace function private.sweep_stale_messages(p_threshold interval, p_as_of timestamptz default now())
returns table (tenant_id uuid, invoice_id uuid, message_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with stale as (
    update public.messages m set send_state = 'unknown', failed_reason = 'stale_pending'
    where m.send_state = 'pending' and m.pending_since < p_as_of - p_threshold
    returning m.tenant_id, m.id, m.idempotency_key, m.purpose
  ), linked as (
    select s.tenant_id, mi.invoice_id, s.id as message_id, s.idempotency_key, s.purpose
    from stale s join public.message_invoices mi on mi.tenant_id = s.tenant_id and mi.message_id = s.id
  ), events as (
    insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
    select l.tenant_id, l.invoice_id, 'MessageStateUnknown', jsonb_build_object('messageId', l.message_id), l.idempotency_key || ':unknown'
    from linked l
    on conflict (tenant_id, idempotency_key) do nothing
  ), parked as (
    update public.invoices i set next_action_at = 'infinity', parked_reason = 'message_unknown', enqueued_at = null
    from linked l where i.tenant_id = l.tenant_id and i.id = l.invoice_id and l.purpose = 'reminder'
  )
  select l.tenant_id, l.invoice_id, l.message_id from linked l;
end $$;
revoke all on function private.sweep_stale_messages(interval, timestamptz) from public, anon, authenticated, service_role;
