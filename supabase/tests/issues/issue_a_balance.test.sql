-- Issue A: no stored amount_paid; balance = total - confirmed payments, derived by a view.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(4);

select hasnt_column('public', 'invoices', 'amount_paid', 'invoices has no stored amount_paid copy');
select has_view('public', 'invoice_balances', 'invoice_balances view exists');

insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 2500, 'GBP', 'bank_transfer', 'TX-1', now()),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 1500, 'GBP', 'bank_transfer', 'TX-2', now());

select results_eq(
  $$select amount_paid, balance from public.invoice_balances where invoice_id = '00000000-0000-0000-0000-0000000001aa'$$,
  $$values (4000::bigint, 6000::bigint)$$,
  'balance is derived from payments'
);
select results_eq(
  $$select amount_paid, balance from public.invoice_balances where invoice_id = '00000000-0000-0000-0000-0000000001bb'$$,
  $$values (0::bigint, 50000::bigint)$$,
  'an invoice with no payments has its full balance'
);

select * from finish();
rollback;
