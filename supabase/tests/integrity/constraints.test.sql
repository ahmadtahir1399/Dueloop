-- Column and table constraints on the core schema.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/two_tenants.inc
select plan(24);

-- Amounts
select throws_ok($$update public.invoices set amount_total = 0 where number = 'A-1'$$, '23514', null, 'zero invoice total rejected');
select throws_ok($$update public.invoices set amount_total = -5 where number = 'A-1'$$, '23514', null, 'negative invoice total rejected');
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 0, 'GBP', 'bank_transfer', 'Z', now())$$,
  '23514', null, 'zero payment rejected');
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', -1, 'GBP', 'bank_transfer', 'N', now())$$,
  '23514', null, 'negative payment rejected');

-- Currency shape
select throws_ok($$update public.tenants set currency = 'usd' where name = 'Tenant A'$$, '23514', null, 'lower-case currency rejected');
select throws_ok($$update public.tenants set currency = 'U$D' where name = 'Tenant A'$$, '23514', null, 'non-letter currency rejected');
select throws_ok($$update public.invoices set currency = 'gbp' where number = 'A-1'$$, '23514', null, 'lower-case invoice currency rejected');

-- Uniqueness
select throws_ok(
  $$insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca', 'A-1', 100, 'GBP', '2026-01-01', '2026-02-01', 'OTHERREF')$$,
  '23505', null, 'duplicate (tenant, number) rejected');
select lives_ok(
  $$insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
    values ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000cb', 'A-1', 100, 'PKR', '2026-01-01', '2026-02-01', 'OTHERREF')$$,
  'the same number in another tenant is fine');
select throws_ok(
  $$insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca', 'A-9', 100, 'GBP', '2026-01-01', '2026-02-01', 'REFAAAA1')$$,
  '23505', null, 'duplicate (tenant, reference_code) rejected');
insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 100, 'GBP', 'stripe', 'pi_1', now());
select throws_ok(
  $$insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001aa', 100, 'GBP', 'stripe', 'pi_1', now())$$,
  '23505', null, 'duplicate payment (tenant, method, provider_ref) rejected');
select lives_ok(
  $$insert into public.customers (tenant_id, display_name, email) values
      ('00000000-0000-0000-0000-00000000000a', 'One', 'shared@example.com'),
      ('00000000-0000-0000-0000-00000000000a', 'Two', 'shared@example.com')$$,
  'two customers may share one mailbox (no unique email, ADR 0010)');

-- Shapes
select throws_ok($$update public.customers set email = 'Mixed@Example.com' where display_name = 'Customer A'$$, '23514', null, 'non-normalised email rejected');
select throws_ok($$update public.customers set phone_e164 = '0300 1234567' where display_name = 'Customer A'$$, '23514', null, 'non-E.164 phone rejected');
select lives_ok($$update public.customers set phone_e164 = '+923001234567', language = 'ur-Latn' where display_name = 'Customer A'$$, 'E.164 phone and BCP 47 locale accepted');
select throws_ok($$update public.customers set language = 'not a locale' where display_name = 'Customer A'$$, '23514', null, 'malformed locale rejected');
select throws_ok($$update public.customers set preferred_channel = 'fax' where display_name = 'Customer A'$$, '23514', null, 'unknown channel rejected');
select throws_ok($$update public.invoices set reference_code = 'ab-1' where number = 'A-1'$$, '23514', null, 'malformed reference code rejected');
select throws_ok(
  $$insert into public.policies (tenant_id, name, steps) values ('00000000-0000-0000-0000-00000000000a', 'Bad', '{"id": 1}')$$,
  '23514', null, 'policy steps must be a JSON array');

-- One default policy per tenant
insert into public.policies (tenant_id, name, steps, is_default) values ('00000000-0000-0000-0000-00000000000a', 'Default', '[]', true);
select throws_ok(
  $$insert into public.policies (tenant_id, name, steps, is_default) values ('00000000-0000-0000-0000-00000000000a', 'Second', '[]', true)$$,
  '23505', null, 'only one default policy per tenant');

-- Total never below confirmed payments
select throws_ok($$update public.invoices set amount_total = 50 where number = 'A-1'$$, '23514', null, 'total below confirmed payments (100) rejected');
select lives_ok($$update public.invoices set amount_total = 100 where number = 'A-1'$$, 'total equal to confirmed payments accepted');

-- Hours (also covered by issue C) and the no-quiet-hours case
select throws_ok($$update public.tenants set quiet_start_hour = 23, quiet_end_hour = 24 where name = 'Tenant A'$$, '23514', null, 'end hour 24 rejected');

-- updated_at moves on update
select ok(
  (select updated_at >= created_at from public.invoices where id = '00000000-0000-0000-0000-0000000001aa'),
  'updated_at is maintained');

select * from finish();
rollback;
