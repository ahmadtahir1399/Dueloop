-- Issue B: a row in tenant A can never reference a row of tenant B (composite FKs).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(4);

select throws_ok(
  $$insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000cb', 'A-X', 100, 'GBP',
            '2026-01-01', '2026-02-01', 'REFXXXX1')$$,
  '23503', null, 'invoice in A pointing at a customer of B is rejected'
);
select throws_ok(
  $$insert into public.invoice_events (tenant_id, invoice_id, type)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001bb', 'InvoiceImported')$$,
  '23503', null, 'event in A pointing at an invoice of B is rejected'
);
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001bb', 100, 'PKR',
            'bank_transfer', 'TX-B', now())$$,
  '23503', null, 'payment in A pointing at an invoice of B is rejected'
);
select throws_ok(
  $$insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000cb', 'email', 'out', 'k1')$$,
  '23503', null, 'message in A pointing at a customer of B is rejected'
);

select * from finish();
rollback;
