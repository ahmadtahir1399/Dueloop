-- Deterministic demo data (guide Section 1.4). Dates are relative to current_date, so "12 overdue"
-- stays true whenever the database is reset. Applied by `supabase db reset` as postgres.
--
-- Tenant A "Demo Agency": Europe/London, wrapping quiet hours 20 -> 9, 40 invoices, exactly 12 overdue
--   in three ageing buckets (1-30, 31-60, 61-90 days), 22 not yet due, 6 paid.
-- Tenant B "Isolation Test Co": America/New_York, non-wrapping quiet hours 1 -> 6, a few invoices.
--
-- Staff users use the minimal auth.users insert from the Supabase RLS testing docs (id, email). They
-- exist for memberships and RLS; they have no password and cannot sign in (sign-in UI is prompt 6).
-- Integration tests create sign-in capable users through the auth admin API instead.

insert into auth.users (id, email) values
  ('5eed0000-0000-4000-8000-0000000000a1', 'owner@demo-agency.test'),
  ('5eed0000-0000-4000-8000-0000000000a2', 'accountant@demo-agency.test'),
  ('5eed0000-0000-4000-8000-0000000000a3', 'collector@demo-agency.test'),
  ('5eed0000-0000-4000-8000-0000000000b1', 'owner@isolation.test');

insert into public.tenants (id, name, timezone, currency, quiet_start_hour, quiet_end_hour, approval_mode) values
  ('5eed0000-0000-4000-8000-00000000000a', 'Demo Agency', 'Europe/London', 'GBP', 20, 9, 'always'),
  ('5eed0000-0000-4000-8000-00000000000b', 'Isolation Test Co', 'America/New_York', 'USD', 1, 6, 'never');

insert into public.memberships (tenant_id, user_id, role) values
  ('5eed0000-0000-4000-8000-00000000000a', '5eed0000-0000-4000-8000-0000000000a1', 'owner'),
  ('5eed0000-0000-4000-8000-00000000000a', '5eed0000-0000-4000-8000-0000000000a2', 'accountant'),
  ('5eed0000-0000-4000-8000-00000000000a', '5eed0000-0000-4000-8000-0000000000a3', 'collector'),
  ('5eed0000-0000-4000-8000-00000000000b', '5eed0000-0000-4000-8000-0000000000b1', 'owner');

insert into public.policies (tenant_id, name, steps, escalate_after_days, grace_days_after_promise, max_messages_per_week, is_default) values
  ('5eed0000-0000-4000-8000-00000000000a', 'Standard', '[
     {"id": "s1", "daysAfterDue": 1, "channel": "email", "templateKey": "friendly"},
     {"id": "s2", "daysAfterDue": 7, "channel": "whatsapp", "templateKey": "nudge"},
     {"id": "s3", "daysAfterDue": 14, "channel": "email", "templateKey": "firm"}
   ]', 21, 2, 3, true),
  ('5eed0000-0000-4000-8000-00000000000b', 'Standard', '[
     {"id": "s1", "daysAfterDue": 3, "channel": "email", "templateKey": "friendly"}
   ]', 30, 3, 2, true);

-- One holiday each: 25 December of the current year (A) and 4 July (B).
insert into public.holidays (tenant_id, on_date, label) values
  ('5eed0000-0000-4000-8000-00000000000a', make_date(extract(year from current_date)::int, 12, 25), 'Christmas Day'),
  ('5eed0000-0000-4000-8000-00000000000b', make_date(extract(year from current_date)::int, 7, 4), 'Independence Day');

-- Tenant A customers: email only, phone only, both, and one opted out.
insert into public.customers (id, tenant_id, display_name, email, phone_e164, language, preferred_channel, opted_out) values
  ('5eed0000-0000-4000-8000-000000000c01', '5eed0000-0000-4000-8000-00000000000a', 'Acme Ltd', 'accounts@acme.example', null, 'en', 'email', false),
  ('5eed0000-0000-4000-8000-000000000c02', '5eed0000-0000-4000-8000-00000000000a', 'Beta Traders', null, '+447700900101', 'en', 'whatsapp', false),
  ('5eed0000-0000-4000-8000-000000000c03', '5eed0000-0000-4000-8000-00000000000a', 'Imran Textiles', 'imran@textiles.example', '+923001234567', 'ur-Latn', 'whatsapp', false),
  ('5eed0000-0000-4000-8000-000000000c04', '5eed0000-0000-4000-8000-00000000000a', 'Müller GmbH', 'buchhaltung@mueller.example', null, 'de', 'email', false),
  ('5eed0000-0000-4000-8000-000000000c05', '5eed0000-0000-4000-8000-00000000000a', 'Gamma & Co', null, '+447700900105', 'en', 'sms', false),
  ('5eed0000-0000-4000-8000-000000000c06', '5eed0000-0000-4000-8000-00000000000a', 'Delta Design', 'hello@delta.example', '+447700900106', 'en', 'email', false),
  ('5eed0000-0000-4000-8000-000000000c07', '5eed0000-0000-4000-8000-00000000000a', 'Opted Out Ltd', 'stop@optedout.example', null, 'en', 'email', true),
  ('5eed0000-0000-4000-8000-000000000c08', '5eed0000-0000-4000-8000-00000000000a', 'شركة الأمل', 'amal@example.ae', '+971501234567', 'ar', 'whatsapp', false);

-- 40 invoices for A. All start open (the trigger requires it) and then move along legal transitions.
with plan(n, customer, days_from_today, minor, kind) as (
  values
    -- 12 overdue: 5 in 1-30 days, 4 in 31-60 days, 3 in 61-90 days
    (1, 1, -3, 125000, 'overdue'), (2, 2, -8, 48000, 'overdue'), (3, 3, -15, 990000, 'overdue'),
    (4, 4, -22, 15050, 'overdue'), (5, 5, -29, 7500, 'overdue'),
    (6, 6, -35, 240050, 'overdue'), (7, 7, -42, 33300, 'overdue'), (8, 8, -50, 410000, 'overdue'),
    (9, 1, -58, 89999, 'overdue'),
    (10, 2, -65, 150000, 'overdue'), (11, 3, -75, 62000, 'overdue'), (12, 4, -88, 1250000, 'overdue'),
    -- 22 not yet due (due today counts as not yet overdue, as in core decide())
    (13, 5, 0, 20000, 'open'), (14, 6, 1, 18000, 'open'), (15, 7, 2, 95000, 'open'), (16, 8, 3, 12000, 'open'),
    (17, 1, 5, 300000, 'open'), (18, 2, 7, 4500, 'open'), (19, 3, 9, 77700, 'open'), (20, 4, 10, 61000, 'open'),
    (21, 5, 12, 25000, 'open'), (22, 6, 14, 52000, 'open'), (23, 7, 16, 8800, 'open'), (24, 8, 18, 140000, 'open'),
    (25, 1, 20, 99900, 'open'), (26, 2, 21, 37500, 'open'), (27, 3, 24, 410000, 'open'), (28, 4, 27, 16000, 'open'),
    (29, 5, 30, 72000, 'open'), (30, 6, 33, 5500, 'open'), (31, 7, 36, 230000, 'open'), (32, 8, 39, 11100, 'open'),
    (33, 1, 42, 64000, 'open'), (34, 2, 45, 19900, 'open'),
    -- 6 paid in full (some were past due when paid)
    (35, 3, -40, 50000, 'paid'), (36, 4, -10, 120000, 'paid'), (37, 5, -2, 9900, 'paid'),
    (38, 6, 4, 45000, 'paid'), (39, 7, 15, 30000, 'paid'), (40, 8, 25, 75000, 'paid')
), codes(n, code) as (
  select ordinality::int, code from unnest(array[
    'FBNM68P5','TA33MD58','7BEXJ287','ASYYRAAK','EANVBX47','3CSRDZP9','MC2Z7YTK','AG7ZMWS3','KFHSSKP5','ZD274YXM',
    '77GKAYWS','2ZMW9KJT','2XVYS2Y2','YGF29TXP','J74GZV8Y','BQV7MY3M','J5MM88BS','6XC3DCX9','VNRC9G8H','35Y6TZ52',
    '77BX4A3J','KKZCHKP2','WHENR6C2','EE57C4FV','F789PPBQ','58WYWQ75','ADZJBYG6','EHSR7Z6V','4C552B2Y','PE3K3D43',
    'ECGJJVDR','F6RSTNBW','RR5QPH5T','ZHHHKQY9','DDRW2ZJG','7BXKVWYH','X9CP6CPN','EVB7PVSV','8H3H5TJF','MHYCEYYE',
    'WHVZY26X','J85F5J56','VKDK76KT','HWTDEXAW','DDG7MC37','4JHA9YNC'
  ]) with ordinality as t(code, ordinality)
)
insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
select
  ('5eed0000-0000-4000-8000-0000000' || lpad(p.n::text, 5, '0'))::uuid,
  '5eed0000-0000-4000-8000-00000000000a',
  ('5eed0000-0000-4000-8000-000000000c' || lpad(p.customer::text, 2, '0'))::uuid,
  'DA-' || lpad(p.n::text, 4, '0'),
  p.minor, 'GBP',
  current_date + p.days_from_today - 30,
  current_date + p.days_from_today,
  c.code
from plan p join codes c using (n);

update public.invoices set status = 'overdue'
where tenant_id = '5eed0000-0000-4000-8000-00000000000a' and number between 'DA-0001' and 'DA-0012';

insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
select tenant_id, id, amount_total, currency, 'bank_transfer', 'SEED-' || number, now() - interval '1 day'
from public.invoices
where tenant_id = '5eed0000-0000-4000-8000-00000000000a' and number between 'DA-0035' and 'DA-0040';

update public.invoices set status = 'paid'
where tenant_id = '5eed0000-0000-4000-8000-00000000000a' and number between 'DA-0035' and 'DA-0040';

-- Tenant B: a few invoices, isolated from A.
insert into public.customers (id, tenant_id, display_name, email) values
  ('5eed0000-0000-4000-8000-000000000cb1', '5eed0000-0000-4000-8000-00000000000b', 'Isolated Customer', 'ap@isolated.example');
insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
values
  ('5eed0000-0000-4000-8000-00000000000b', '5eed0000-0000-4000-8000-000000000cb1', 'B-0001', 50000, 'USD', current_date - 40, current_date - 10, 'X9CP6CPN'),
  ('5eed0000-0000-4000-8000-00000000000b', '5eed0000-0000-4000-8000-000000000cb1', 'B-0002', 70000, 'USD', current_date - 5, current_date + 25, 'EVB7PVSV'),
  ('5eed0000-0000-4000-8000-00000000000b', '5eed0000-0000-4000-8000-000000000cb1', 'B-0003', 90000, 'USD', current_date, current_date + 30, '8H3H5TJF');
update public.invoices set status = 'overdue' where number = 'B-0001';
