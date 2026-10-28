-- Prompt 5, issue P: KPI functions against hand-computed fixtures. Tenant K is in Asia/Kolkata (UTC+05:30), and
-- the reference instant 2026-07-01 20:00 UTC is ALREADY 2 July there: every expected value below would differ
-- if days were grouped by UTC. Bucket boundaries 30/31, 60/61, 90/91 are covered exactly.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc

select plan(19);

insert into public.tenants (id, name, timezone, currency) values ('00000000-0000-0000-0000-0000000000d0', 'K', 'Asia/Kolkata', 'INR');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'owner@k.test');
insert into public.memberships (tenant_id, user_id, role) values ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000d1', 'owner');
insert into public.customers (id, tenant_id, display_name) values ('00000000-0000-0000-0000-0000000000dc', '00000000-0000-0000-0000-0000000000d0', 'Cust K');

-- Local today (Kolkata) at the reference instant = 2026-07-02. due_on chosen for days_past_due 0,1,30,31,60,61,90,91.
insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
select ('00000000-0000-0000-0000-0000000002' || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000dc',
       'K-' || n, 1000, 'INR', d - 10, d, 'REFK' || lpad(n::text, 4, '0')
from (values (0, date '2026-07-02'), (1, date '2026-07-01'), (30, date '2026-06-02'), (31, date '2026-06-01'),
             (60, date '2026-05-03'), (61, date '2026-05-02'), (90, date '2026-04-03'), (91, date '2026-04-02')) v(n, d);
update public.invoices set status = 'overdue' where tenant_id = '00000000-0000-0000-0000-0000000000d0' and number <> 'K-0';
-- K-91 is partly paid: 400 of 1000 (balance 600 stays in 91+).
insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
values ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-000000000291', 400, 'INR', 'bank_transfer', 'K-P1', '2026-06-20 10:00+00');

-- Two paid invoices for days-to-pay and recovered.
insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code) values
  ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000dc', 'K-PA', 5000, 'INR', '2026-06-01', '2026-06-15', 'REFKPA01'),
  ('00000000-0000-0000-0000-0000000003a2', '00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000dc', 'K-PB', 3000, 'INR', '2026-06-10', '2026-06-20', 'REFKPB01');
update public.invoices set status = 'overdue' where id in ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000003a2');
-- K-PA paid 30 June 19:00 UTC = 1 July 00:30 Kolkata (days_to_pay 30, after due 16).
insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
values ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000003a1', 5000, 'INR', 'bank_transfer', 'K-P2', '2026-06-30 19:00+00');
-- K-PB paid in two parts; the last on 2 July 03:00 UTC = 2 July 08:30 Kolkata (days_to_pay 22, after due 12).
insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at) values
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000003a2', 1000, 'INR', 'bank_transfer', 'K-P3', '2026-06-25 06:00+00'),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000003a2', 2000, 'INR', 'bank_transfer', 'K-P4', '2026-07-02 03:00+00');
update public.invoices set status = 'paid' where id in ('00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000003a2');

-- Ageing and overdue as of 2026-07-01 20:00 UTC.
select is((select balance from public.kpi_ageing('2026-07-01 20:00+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0' and bucket = 'not_due'), 1000::bigint, 'due today (local) is not due');
select is((select invoices from public.kpi_ageing('2026-07-01 20:00+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0' and bucket = '1-30'), 2::bigint, '1-30 holds days 1 and 30');
select is((select invoices from public.kpi_ageing('2026-07-01 20:00+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0' and bucket = '31-60'), 2::bigint, '31-60 holds days 31 and 60');
select is((select invoices from public.kpi_ageing('2026-07-01 20:00+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0' and bucket = '61-90'), 2::bigint, '61-90 holds days 61 and 90');
select is((select balance from public.kpi_ageing('2026-07-01 20:00+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0' and bucket = '91+'), 600::bigint, '91+ holds day 91 at its remaining balance');
select is((select row(invoices, balance)::text from public.kpi_overdue_total('2026-07-01 20:00+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0'), '(7,6600)', 'overdue total: 7 invoices, 6,600 minor');
-- The same instant read as a UTC day would put the day-30 invoice in 1-30 with 29 days and day-31 at 30: prove the shift.
select is((select invoices from public.kpi_ageing('2026-07-01 18:29+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0' and bucket = 'not_due'), 2::bigint, 'at 23:59 local on 1 July the 1 July invoice is not yet overdue');
select is((select invoices from public.kpi_ageing('2026-07-01 18:30+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0' and bucket = 'not_due'), 1::bigint, 'at 00:00 local on 2 July it is');

-- Recovered: local dates. 1-7 July (local) holds K-P2 (5000, local 1 July) and K-P4 (2000); not K-P1, K-P3.
select is((select recovered from public.kpi_recovered('2026-07-01', '2026-07-07') where tenant_id = '00000000-0000-0000-0000-0000000000d0'), 7000::bigint, 'recovered in 1-7 July local');
select is((select recovered from public.kpi_recovered('2026-06-24', '2026-06-30') where tenant_id = '00000000-0000-0000-0000-0000000000d0'), 1000::bigint, 'K-P2 (30 June UTC) is NOT in the June 24-30 local week');

-- Days to pay: K-PA 30 days (16 after due), K-PB 22 days (12 after due) => 26.0 and 14.0.
select is((select row(invoices, avg_days_to_pay, avg_days_after_due)::text from public.kpi_days_to_pay('2026-07-01', '2026-07-07') where tenant_id = '00000000-0000-0000-0000-0000000000d0'), '(2,26.0,14.0)', 'average days to pay and days after due');

-- Promise-kept rate over resolution local dates.
insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, reference_at, status, resolved_at, resolved_by) values
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000003a1', '00000000-0000-0000-0000-0000000000dc', '2026-06-28', now(), 'kept', '2026-06-30 19:00+00', 'payment'),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-0000000000dc', '2026-06-28', now(), 'broken', '2026-07-03 10:00+00', 'worker'),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-000000000230', '00000000-0000-0000-0000-0000000000dc', '2026-06-20', now(), 'broken', '2026-06-30 18:00+00', 'worker'),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-0000000000dc', '2026-06-20', now(), 'superseded', '2026-07-02 10:00+00', 'reply');
select is((select row(kept, broken, rate)::text from public.kpi_promise_kept_rate('2026-07-01', '2026-07-07') where tenant_id = '00000000-0000-0000-0000-0000000000d0'), '(1,1,0.5000)', 'kept / (kept + broken); superseded ignored; 30 June 18:00 UTC is 30 June local (excluded)');
select is((select count(*)::int from public.kpi_promise_kept_rate('2026-08-01', '2026-08-07') where tenant_id = '00000000-0000-0000-0000-0000000000d0'), 0, 'no resolved promises => no row (rate undefined, never 0)');

-- Messages sent and cost.
insert into public.messages (tenant_id, customer_id, channel, direction, purpose, idempotency_key, send_state, sent_at, pending_since, cost_minor) values
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000dc', 'email', 'out', 'reminder', 'k:m1', 'sent', '2026-06-30 19:00+00', '2026-06-30 19:00+00', 0),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000dc', 'whatsapp', 'out', 'reminder', 'k:m2', 'sent', '2026-07-02 05:00+00', '2026-07-02 05:00+00', 120),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000dc', 'email', 'out', 'receipt', 'k:m3', 'sent', '2026-07-02 05:00+00', '2026-07-02 05:00+00', 0),
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000dc', 'email', 'out', 'reminder', 'k:m4', 'unknown', null, '2026-07-02 05:00+00', 0);
select is((select sum(sent)::int from public.kpi_messages('2026-07-01', '2026-07-07') where tenant_id = '00000000-0000-0000-0000-0000000000d0' and purpose = 'reminder'), 2, 'reminders sent in the local week (unknown not counted)');
select is((select sum(cost_minor)::int from public.kpi_messages('2026-07-01', '2026-07-07') where tenant_id = '00000000-0000-0000-0000-0000000000d0'), 120, 'cost in the period');

-- This week: Monday..Sunday in the tenant's zone.
select is((select extract(isodow from week_start)::int from public.kpi_this_week where tenant_id = '00000000-0000-0000-0000-0000000000d0'), 1, 'this week starts on a local Monday');

-- RLS: functions are security invoker; another tenant's owner sees nothing of K, K's owner sees K.
select is(pg_temp.try_as('00000000-0000-0000-0000-0000000000a1', $$select 1 from public.kpi_ageing('2026-07-01 20:00+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0'$$), 'ok:0', 'tenant A cannot see K ageing');
select is(pg_temp.try_as('00000000-0000-0000-0000-0000000000a1', $$select 1 from public.kpi_recovered('2026-01-01', '2026-12-31') where tenant_id = '00000000-0000-0000-0000-0000000000d0' union all select 1 from public.kpi_messages('2026-01-01', '2026-12-31') where tenant_id = '00000000-0000-0000-0000-0000000000d0' union all select 1 from public.kpi_overdue_now where tenant_id = '00000000-0000-0000-0000-0000000000d0'$$), 'ok:0', 'nor recovered, messages or the now-views');
select is(pg_temp.try_as('00000000-0000-0000-0000-0000000000d1', $$select 1 from public.kpi_ageing('2026-07-01 20:00+00') where tenant_id = '00000000-0000-0000-0000-0000000000d0'$$), 'ok:5', 'K''s owner sees K''s five buckets');

select * from finish();
rollback;
