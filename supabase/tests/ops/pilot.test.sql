-- Prompt 7 step 11 (migration 0023): KPI snapshots against hand-computed values. Tenant P is in Asia/Kolkata
-- (UTC+05:30). P-1 is paid at 2026-03-31 20:00 UTC = 1 April 01:30 local, so it is APRIL's recovered money there;
-- grouping by UTC would put it in March. Expected values were worked out by hand before running.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(12);

insert into public.tenants (id, name, timezone, currency) values ('00000000-0000-0000-0000-0000000000e0', 'P', 'Asia/Kolkata', 'INR');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'owner@p.test');
insert into public.memberships (tenant_id, user_id, role) values ('00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e1', 'owner');
insert into public.customers (id, tenant_id, display_name) values ('00000000-0000-0000-0000-0000000000ec', '00000000-0000-0000-0000-0000000000e0', 'Cust P');
insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code) values
  ('00000000-0000-0000-0000-0000000004e1', '00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000ec', 'P-1', 10000, 'INR', '2026-03-01', '2026-03-15', 'REFPONE1'),
  ('00000000-0000-0000-0000-0000000004e2', '00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000ec', 'P-2', 4000, 'INR', '2026-03-05', '2026-03-20', 'REFPTWO2');
update public.invoices set status = 'overdue' where tenant_id = '00000000-0000-0000-0000-0000000000e0';

-- Baseline before any payment: both invoices overdue, 10000 + 4000 = 14000; nothing recovered in March.
select private.kpi_snapshot('00000000-0000-0000-0000-0000000000e0', 'baseline', '2026-03-01', '2026-03-31', '2026-03-31 18:00+00', 'test', null, '{"staff_hours_per_week": 6}');
select is((select kpis -> 'overdue' -> 0 ->> 'balance' from public.kpi_snapshots where tenant_id = '00000000-0000-0000-0000-0000000000e0' and kind = 'baseline'), '14000', 'baseline overdue balance = 14000 (money stored as text)');
select is((select (kpis -> 'overdue' -> 0 ->> 'invoices')::int from public.kpi_snapshots where tenant_id = '00000000-0000-0000-0000-0000000000e0' and kind = 'baseline'), 2, 'baseline overdue invoices = 2');
select is((select client_reported ->> 'staff_hours_per_week' from public.kpi_snapshots where tenant_id = '00000000-0000-0000-0000-0000000000e0' and kind = 'baseline'), '6', 'client-reported values are kept apart from system KPIs');
select throws_ok($$select private.kpi_snapshot('00000000-0000-0000-0000-0000000000e0', 'baseline', '2026-03-01', '2026-03-31', now(), 'test', null, '{}')$$, '23505', null, 'one baseline per tenant');

-- P-1 paid in full: receipt + payment at 2026-03-31 20:00 UTC (= 2026-04-01 01:30 Kolkata).
insert into public.receipts (id, tenant_id, invoice_id, customer_id, method, source, provider_ref, amount, currency, received_at)
values ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000004e1', '00000000-0000-0000-0000-0000000000ec', 'bank_transfer', 'manual', 'P-REF-1', 10000, 'INR', '2026-03-31 20:00+00');
insert into public.payments (tenant_id, invoice_id, receipt_id, amount, currency, method, provider_ref, paid_at, source)
values ('00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000004e1', '00000000-0000-0000-0000-0000000005e1', 10000, 'INR', 'bank_transfer', 'P-REF-1', '2026-03-31 20:00+00', 'manual');
update public.invoices set status = 'paid' where id = '00000000-0000-0000-0000-0000000004e1';

select private.kpi_snapshot('00000000-0000-0000-0000-0000000000e0', 'periodic', '2026-03-01', '2026-03-31', '2026-04-30 12:00+00', 'test', 'march', '{}');
select private.kpi_snapshot('00000000-0000-0000-0000-0000000000e0', 'periodic', '2026-04-01', '2026-04-30', '2026-04-30 12:00+00', 'test', 'april', '{}');
select is((select jsonb_array_length(kpis -> 'recovered') from public.kpi_snapshots where notes = 'march'), 0, 'March (local) recovered nothing: the payment was already 1 April in Kolkata');
select is((select kpis -> 'recovered' -> 0 ->> 'recovered' from public.kpi_snapshots where notes = 'april'), '10000', 'April (local) recovered 10000');
select is((select kpis -> 'overdue' -> 0 ->> 'balance' from public.kpi_snapshots where notes = 'april'), '4000', 'overdue now = only P-2 (4000)');
select is((select (kpis -> 'days_to_pay' ->> 'avg_days_to_pay')::numeric from public.kpi_snapshots where notes = 'april'), 31.0, 'days to pay: 2026-04-01 - 2026-03-01 = 31 (local paid date)');
select is((select (kpis -> 'days_to_pay' ->> 'avg_days_after_due')::numeric from public.kpi_snapshots where notes = 'april'), 17.0, 'days after due: 2026-04-01 - 2026-03-15 = 17');

-- Access: service-only writes; owners read their own tenant only.
select ok(not has_function_privilege('authenticated', 'private.kpi_snapshot(uuid, text, date, date, timestamptz, text, text, jsonb)', 'execute'), 'no API role can take a snapshot');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e1', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.kpi_snapshots), 3, 'the owner of P reads P''s three snapshots and nothing else');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.kpi_snapshots where tenant_id = '00000000-0000-0000-0000-0000000000e0'), 0, 'the owner of another tenant reads none of P''s');

select * from finish();
rollback;
