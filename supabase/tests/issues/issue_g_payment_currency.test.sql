-- Issue G: a payment carries a currency and it must equal the invoice currency.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(3);

select has_column('public', 'payments', 'currency', 'payments has a currency');
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 100, 'USD',
            'bank_transfer', 'TX-USD', now())$$,
  '23503', null, 'USD payment on a GBP invoice is rejected'
);
select lives_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 100, 'GBP',
            'bank_transfer', 'TX-GBP', now())$$,
  'GBP payment on a GBP invoice is accepted'
);

select * from finish();
rollback;
