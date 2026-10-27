-- The demo seed matches guide Section 1.4 on every reset (dates are relative to current_date).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select is((select count(*)::int from public.tenants where name in ('Demo Agency', 'Isolation Test Co')), 2, 'two demo tenants');
select is((select count(*)::int from public.invoices i join public.tenants t on t.id = i.tenant_id where t.name = 'Demo Agency'), 40, 'Demo Agency has 40 invoices');
select is((select count(*)::int from public.invoices i join public.tenants t on t.id = i.tenant_id
           where t.name = 'Demo Agency' and i.status = 'overdue'), 12, 'exactly 12 have status overdue');
select is((select count(*)::int from public.invoice_balances b join public.invoices i on i.id = b.invoice_id
           join public.tenants t on t.id = i.tenant_id
           where t.name = 'Demo Agency' and i.due_on < current_date and b.balance > 0
             and i.status not in ('paid', 'written_off', 'cancelled')), 12, 'exactly 12 are past due with a balance');
select is(
  (select array_agg(n order by bucket) from (
     select case when current_date - i.due_on <= 30 then 1 when current_date - i.due_on <= 60 then 2 else 3 end as bucket, count(*)::int as n
     from public.invoices i join public.tenants t on t.id = i.tenant_id
     where t.name = 'Demo Agency' and i.status = 'overdue' group by 1) q),
  array[5, 4, 3], 'three ageing buckets: 5 / 4 / 3');
select ok((select bool_and(current_date - i.due_on between 1 and 90) from public.invoices i
           join public.tenants t on t.id = i.tenant_id where t.name = 'Demo Agency' and i.status = 'overdue'), 'every overdue invoice is 1-90 days late');
select is((select count(*)::int from public.invoice_balances b join public.tenants t on t.id = b.tenant_id
           where t.name = 'Demo Agency' and b.balance = 0), 6, 'six invoices are paid in full');
select ok(
  (select count(*) filter (where email is not null and phone_e164 is null) > 0
      and count(*) filter (where email is null and phone_e164 is not null) > 0
      and count(*) filter (where opted_out) = 1
   from public.customers c join public.tenants t on t.id = c.tenant_id where t.name = 'Demo Agency'),
  'customers: some email only, some phone only, exactly one opted out');
select is((select count(*)::int from public.holidays h join public.tenants t on t.id = h.tenant_id where t.name = 'Demo Agency'), 1, 'one holiday');
select ok((select quiet_start_hour > quiet_end_hour from public.tenants where name = 'Demo Agency')
          and (select quiet_start_hour < quiet_end_hour from public.tenants where name = 'Isolation Test Co'),
          'A has wrapping quiet hours, B non-wrapping');
select is((select array_agg(m.role order by m.role) from public.memberships m join public.tenants t on t.id = m.tenant_id where t.name = 'Demo Agency'),
          array['accountant', 'collector', 'owner'], 'three staff roles in Demo Agency');

select * from finish();
rollback;
