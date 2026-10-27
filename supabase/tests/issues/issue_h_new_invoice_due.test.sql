-- Issue H: a freshly inserted open invoice is due for evaluation (next_action_at is never NULL).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(3);

select col_not_null('public', 'invoices', 'next_action_at', 'next_action_at is NOT NULL');
select has_view('public', 'invoices_due', 'invoices_due view exists');
select ok(
  exists (select 1 from public.invoices_due where id = '00000000-0000-0000-0000-0000000001aa'),
  'a new open invoice inserted without next_action_at is due'
);

select * from finish();
rollback;
