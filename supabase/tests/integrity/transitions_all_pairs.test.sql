-- Every (from, to) pair of the 8 statuses against the status trigger.
-- The legal list below is written from guide Section 3.3 by hand, independently of
-- private.invoice_status_transitions (the drift test in packages/db compares that table to core).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc

create temp table legal (from_status text, to_status text) on commit drop;
insert into legal values
  ('open', 'overdue'), ('overdue', 'promised'), ('promised', 'overdue'),
  ('open', 'disputed'), ('overdue', 'disputed'), ('promised', 'disputed'), ('escalated', 'disputed'),
  ('overdue', 'escalated'), ('promised', 'escalated'),
  ('open', 'paid'), ('overdue', 'paid'), ('promised', 'paid'), ('disputed', 'paid'), ('escalated', 'paid'),
  ('escalated', 'written_off'), ('open', 'cancelled');

-- A legal path from open to each status, used to put a fresh invoice into the "from" state.
create temp table paths (status text, path text[]) on commit drop;
insert into paths values
  ('open', '{}'), ('overdue', '{overdue}'), ('promised', '{overdue,promised}'), ('disputed', '{disputed}'),
  ('escalated', '{overdue,escalated}'), ('paid', '{paid}'), ('written_off', '{overdue,escalated,written_off}'),
  ('cancelled', '{cancelled}');

create function pg_temp.try_transition(from_status text, to_status text) returns text
language plpgsql as $fn$
declare
  inv uuid;
  step text;
begin
  insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca',
          'T-' || gen_random_uuid(), 100, 'GBP', '2026-01-01', '2026-02-01',
          upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)))
  returning id into inv;
  foreach step in array (select path from pg_temp.paths where status = from_status) loop
    update public.invoices set status = step where id = inv;
  end loop;
  begin
    update public.invoices set status = to_status where id = inv;
    return 'allowed';
  exception when sqlstate '23514' then
    return 'rejected';
  end;
end $fn$;

create temp table statuses (s text) on commit drop;
insert into statuses values ('open'), ('overdue'), ('promised'), ('disputed'), ('escalated'), ('paid'), ('written_off'), ('cancelled');

select plan(64 + 3);

select is(
  pg_temp.try_transition(f.s, t.s),
  case
    when f.s = t.s then 'allowed' -- not a change; the trigger only judges real status changes
    when exists (select 1 from legal l where l.from_status = f.s and l.to_status = t.s) then 'allowed'
    else 'rejected'
  end,
  format('%s -> %s', f.s, t.s)
)
from statuses f cross join statuses t
order by f.s, t.s;

-- Final states: no status change at all, to anything.
select is(
  (select count(*)::int from statuses f cross join statuses t
   where f.s in ('paid', 'written_off', 'cancelled') and f.s <> t.s
     and pg_temp.try_transition(f.s, t.s || '') = 'allowed'),
  0, 'paid, written_off and cancelled can never change status'
);

-- The status CHECK list equals the 8 statuses.
select is(
  (select array_agg(x order by x) from (
     select unnest(regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g')) as x
     from pg_constraint c where c.conrelid = 'public.invoices'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%status%') q),
  (select array_agg(s order by s) from statuses),
  'invoices.status CHECK lists exactly the 8 statuses'
);

select throws_ok(
  $$insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code, status)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca', 'T-X', 100, 'GBP', '2026-01-01', '2026-02-01', 'TXREF001', 'overdue')$$,
  '23514', null, 'inserting straight into overdue is rejected'
);

select * from finish();
rollback;
