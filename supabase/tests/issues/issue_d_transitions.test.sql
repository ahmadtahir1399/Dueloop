-- Issue D: illegal status transitions are rejected by the database; final states never move.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(5);

select throws_ok($$update public.invoices set status = 'promised' where number = 'A-1'$$, '23514', null, 'open -> promised is illegal');
select lives_ok($$update public.invoices set status = 'overdue' where number = 'A-1'$$, 'open -> overdue is legal');
select lives_ok($$update public.invoices set status = 'paid' where number = 'A-1'$$, 'overdue -> paid is legal');
select throws_ok($$update public.invoices set status = 'overdue' where number = 'A-1'$$, '23514', null, 'paid is final');
select throws_ok(
  $$insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code, status)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca', 'A-2', 100, 'GBP',
            '2026-01-01', '2026-02-01', 'REFAAAA2', 'paid')$$,
  '23514', null, 'a new invoice must start open'
);

select * from finish();
rollback;
