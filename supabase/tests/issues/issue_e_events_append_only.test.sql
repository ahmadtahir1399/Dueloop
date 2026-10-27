-- Issue E: invoice_events is append-only, enforced (not by comment).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(3);

insert into public.invoice_events (tenant_id, invoice_id, type) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 'InvoiceImported');

select throws_ok($$update public.invoice_events set payload = '{"x": 1}'$$, '23514', null, 'UPDATE rejected, even for postgres');
select throws_ok($$delete from public.invoice_events$$, '23514', null, 'DELETE rejected, even for postgres');
select throws_ok($$delete from public.invoices where number = 'A-1'$$, '23503', null, 'an invoice with history cannot be deleted');

select * from finish();
rollback;
