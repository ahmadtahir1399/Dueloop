-- Prompt 5, issue M / step 13: the proof-of-payment inbox. An inbound message (prompt 4) that is LINKED to an
-- invoice and carries image or PDF attachments queues one proof_fetch job, in the same transaction as the link.
-- Unmatched messages are never fetched: their attachments stay metadata on the human task (rule 24).
select pgmq.create('proof_fetch');

-- One proof per (message, attachment position): fetching twice can never store a second copy.
alter table public.payment_proofs add column attachment_index integer check (attachment_index is null or attachment_index between 0 and 49);
alter table public.payment_proofs add constraint payment_proofs_message_attachment unique (tenant_id, message_id, attachment_index);

-- The declared MIME type only decides whether a fetch is worth trying; the file is sniffed before anything else.
create function private.enqueue_proof_fetch() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.messages m, jsonb_array_elements(m.attachments) a
    where m.tenant_id = new.tenant_id and m.id = new.message_id and m.direction = 'in'
      and (a ->> 'mime' like 'image/%' or a ->> 'mime' = 'application/pdf')
  ) then
    perform pgmq.send('proof_fetch', jsonb_build_object('tenant_id', new.tenant_id, 'message_id', new.message_id));
  end if;
  return new;
end $$;
revoke all on function private.enqueue_proof_fetch() from public, anon, authenticated, service_role;
create trigger message_invoices_proof_fetch after insert on public.message_invoices
  for each row execute function private.enqueue_proof_fetch();

alter table public.dead_letters drop constraint dead_letters_source_check;
alter table public.dead_letters add constraint dead_letters_source_check check (source in ('followup_actions', 'inbound_events', 'payment_events', 'transactional_sends', 'proof_fetch'));
