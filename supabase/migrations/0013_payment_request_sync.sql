-- Prompt 5, issue F: a request deactivated in OUR rows (paid, balance changed, invoice closed) must also stop
-- accepting money at the provider. apply_payment deactivates rows inside the ledger transaction; the provider
-- call happens after commit, so it is tracked here and retried by the sweep until it succeeds.
alter table public.payment_requests add column provider_deactivated_at timestamptz;

-- Rows without a provider object (bank instructions) have nothing to switch off.
update public.payment_requests set provider_deactivated_at = deactivated_at where status <> 'active' and provider_object_id is null;

create index payment_requests_provider_sync on public.payment_requests (deactivated_at)
  where status <> 'active' and provider_object_id is not null and provider_deactivated_at is null;
