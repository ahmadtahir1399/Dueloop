-- Shared fixture (included with \ir; not a test file). Runs as postgres inside the caller's
-- transaction, which always ends in rollback.
-- Tenants A and B; users: owner/accountant/collector of A, owner of B, an outsider with no membership.
-- One row in every tenant-owned table for each tenant.

-- Minimal auth users, as in the Supabase RLS testing docs.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@test.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'accountant-a@test.invalid'),
  ('00000000-0000-0000-0000-0000000000a3', 'collector-a@test.invalid'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner-b@test.invalid'),
  ('00000000-0000-0000-0000-0000000000c1', 'outsider@test.invalid');

insert into public.tenants (id, name, timezone, currency) values
  ('00000000-0000-0000-0000-00000000000a', 'Tenant A', 'Europe/London', 'GBP'),
  ('00000000-0000-0000-0000-00000000000b', 'Tenant B', 'Asia/Karachi', 'PKR');

insert into public.memberships (tenant_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'accountant'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'collector'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'owner');

-- ca/cb have invoices; fa/fb have none (deletable).
insert into public.customers (id, tenant_id, display_name) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000000a', 'Customer A'),
  ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-00000000000a', 'Free A'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000000b', 'Customer B'),
  ('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-00000000000b', 'Free B');

insert into public.policies (id, tenant_id, name, steps) values
  ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-00000000000a', 'Policy A', '[]'),
  ('00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-00000000000b', 'Policy B', '[]');

insert into public.holidays (tenant_id, on_date, label) values
  ('00000000-0000-0000-0000-00000000000a', '2026-12-25', 'Christmas'),
  ('00000000-0000-0000-0000-00000000000b', '2026-08-14', 'Independence Day');

insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code) values
  ('00000000-0000-0000-0000-0000000001aa', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca',
   'A-1', 10000, 'GBP', '2026-01-01', '2026-02-01', 'REFAAAA1'),
  ('00000000-0000-0000-0000-0000000001bb', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000cb',
   'B-1', 50000, 'PKR', '2026-01-01', '2026-02-01', 'REFBBBB1');

insert into public.invoice_events (tenant_id, invoice_id, type) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 'InvoiceImported'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000001bb', 'InvoiceImported');

insert into public.messages (id, tenant_id, customer_id, channel, direction, idempotency_key) values
  ('00000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca', 'email', 'out', 'A-1:s1:email'),
  ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000cb', 'email', 'out', 'B-1:s1:email');

insert into public.message_invoices (tenant_id, message_id, invoice_id) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-0000000001aa'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-0000000001bb');

insert into public.payments (id, tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at) values
  ('00000000-0000-0000-0000-0000000002aa', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 100, 'GBP', 'bank_transfer', 'TX-A', now()),
  ('00000000-0000-0000-0000-0000000002bb', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000001bb', 100, 'PKR', 'bank_transfer', 'TX-B', now());

insert into public.import_batches (id, tenant_id, file_name, file_sha256, mapping, options) values
  ('00000000-0000-0000-0000-0000000003aa', '00000000-0000-0000-0000-00000000000a', 'a.csv', repeat('a', 64), '{}', '{}'),
  ('00000000-0000-0000-0000-0000000003bb', '00000000-0000-0000-0000-00000000000b', 'b.csv', repeat('b', 64), '{}', '{}');

insert into public.import_rows (tenant_id, batch_id, row_number, raw, normalised) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000003aa', 2, '[]', '{}'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000003bb', 2, '[]', '{}');

-- Runs `stmt` as `actor` (NULL = anon) and ALWAYS rolls it back (subtransaction).
-- Returns 'ok:<rows affected>' or 'err:<sqlstate>'.
create function pg_temp.try_as(actor uuid, stmt text) returns text
language plpgsql as $fn$
declare
  n bigint;
begin
  begin
    if actor is null then
      perform set_config('request.jwt.claims', '{"role": "anon"}', true);
      perform set_config('request.jwt.claim.sub', '', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', actor::text, true);
      set local role authenticated;
    end if;
    execute stmt;
    get diagnostics n = row_count;
    raise exception using errcode = 'ZR001', message = n::text; -- undo whatever the statement did
  exception
    when sqlstate 'ZR001' then return 'ok:' || sqlerrm;
    when others then return 'err:' || sqlstate;
  end;
end $fn$;

-- allow = affected/returned at least one row; deny = no rows or a permission error (42501).
create function pg_temp.outcome(r text) returns text language sql as $fn$
  select case
    when r ~ '^ok:[1-9]' then 'allow'
    when r = 'ok:0' or r = 'err:42501' then 'deny'
    else r
  end
$fn$;
