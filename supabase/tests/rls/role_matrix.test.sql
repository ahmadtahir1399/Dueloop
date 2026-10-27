-- ADR 0008 role matrix, cell by cell, for every tenant-owned table.
-- Each statement runs as each actor against tenant A (own) and tenant B (foreign) rows.
-- Expected for B rows: deny for everyone. Outsider (no membership) and anon: deny everything.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc

-- Statement templates. Placeholders are replaced per target tenant below.
create temp table ops (tbl text, op text, stmt text, primary key (tbl, op)) on commit drop;
insert into ops values
  ('tenants', 'select', $$select 1 from public.tenants where id = '{T}'$$),
  ('tenants', 'insert', $$insert into public.tenants (name, timezone, currency) values ('X', 'UTC', 'USD')$$),
  ('tenants', 'update', $$update public.tenants set name = name where id = '{T}'$$),
  ('tenants', 'delete', $$delete from public.tenants where id = '{T}'$$),
  ('memberships', 'select', $$select 1 from public.memberships where tenant_id = '{T}'$$),
  ('memberships', 'insert', $$insert into public.memberships (tenant_id, user_id, role) values ('{T}', '00000000-0000-0000-0000-0000000000c1', 'collector')$$),
  ('memberships', 'update', $$update public.memberships set role = role where tenant_id = '{T}' and user_id = '{MEMBER}'$$),
  ('memberships', 'delete', $$delete from public.memberships where tenant_id = '{T}' and user_id = '{MEMBER}'$$),
  ('customers', 'select', $$select 1 from public.customers where tenant_id = '{T}'$$),
  ('customers', 'insert', $$insert into public.customers (tenant_id, display_name) values ('{T}', 'New customer')$$),
  ('customers', 'update', $$update public.customers set display_name = display_name where tenant_id = '{T}'$$),
  ('customers', 'delete', $$delete from public.customers where id = '{FREE}'$$),
  ('policies', 'select', $$select 1 from public.policies where tenant_id = '{T}'$$),
  ('policies', 'insert', $$insert into public.policies (tenant_id, name, steps) values ('{T}', 'New', '[]')$$),
  ('policies', 'update', $$update public.policies set name = name where tenant_id = '{T}'$$),
  ('policies', 'delete', $$delete from public.policies where id = '{POL}'$$),
  ('holidays', 'select', $$select 1 from public.holidays where tenant_id = '{T}'$$),
  ('holidays', 'insert', $$insert into public.holidays (tenant_id, on_date) values ('{T}', '2031-01-01')$$),
  ('holidays', 'update', $$update public.holidays set label = label where tenant_id = '{T}'$$),
  ('holidays', 'delete', $$delete from public.holidays where tenant_id = '{T}'$$),
  ('invoices', 'select', $$select 1 from public.invoices where tenant_id = '{T}'$$),
  ('invoices', 'insert', $$insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
                           values ('{T}', '{CUST}', 'NEW-1', 100, '{CUR}', '2026-01-01', '2026-02-01', 'NEWREF01')$$),
  ('invoices', 'update', $$update public.invoices set due_on = due_on where tenant_id = '{T}'$$),
  ('invoices', 'delete', $$delete from public.invoices where id = '{INV}'$$),
  ('invoice_events', 'select', $$select 1 from public.invoice_events where tenant_id = '{T}'$$),
  ('invoice_events', 'insert', $$insert into public.invoice_events (tenant_id, invoice_id, type) values ('{T}', '{INV}', 'InvoiceImported')$$),
  ('invoice_events', 'update', $$update public.invoice_events set payload = payload where tenant_id = '{T}'$$),
  ('invoice_events', 'delete', $$delete from public.invoice_events where tenant_id = '{T}'$$),
  ('messages', 'select', $$select 1 from public.messages where tenant_id = '{T}'$$),
  ('messages', 'insert', $$insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key) values ('{T}', '{CUST}', 'sms', 'out', 'new-key')$$),
  ('messages', 'update', $$update public.messages set body = body where tenant_id = '{T}'$$),
  ('messages', 'delete', $$delete from public.messages where tenant_id = '{T}'$$),
  ('message_invoices', 'select', $$select 1 from public.message_invoices where tenant_id = '{T}'$$),
  ('message_invoices', 'insert', $$insert into public.message_invoices (tenant_id, message_id, invoice_id) values ('{T}', '{MSG}', '{INV}')$$),
  ('message_invoices', 'update', $$update public.message_invoices set invoice_id = invoice_id where tenant_id = '{T}'$$),
  ('message_invoices', 'delete', $$delete from public.message_invoices where tenant_id = '{T}'$$),
  ('payments', 'select', $$select 1 from public.payments where tenant_id = '{T}'$$),
  ('payments', 'insert', $$insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at)
                           values ('{T}', '{INV}', 1, '{CUR}', 'bank_transfer', 'NEW-TX', now())$$),
  ('payments', 'update', $$update public.payments set paid_at = paid_at where tenant_id = '{T}'$$),
  ('payments', 'delete', $$delete from public.payments where tenant_id = '{T}'$$),
  ('import_batches', 'select', $$select 1 from public.import_batches where tenant_id = '{T}'$$),
  ('import_batches', 'insert', $$insert into public.import_batches (tenant_id, uploaded_by, file_name, file_sha256, mapping, options)
                                 values ('{T}', auth.uid(), 'n.csv', repeat('c', 64), '{}', '{}')$$),
  ('import_batches', 'update', $$update public.import_batches set counts = counts where tenant_id = '{T}'$$),
  ('import_batches', 'delete', $$delete from public.import_batches where tenant_id = '{T}'$$),
  ('import_rows', 'select', $$select 1 from public.import_rows where tenant_id = '{T}'$$),
  ('import_rows', 'insert', $$insert into public.import_rows (tenant_id, batch_id, row_number, raw, normalised) values ('{T}', '{BATCH}', 99, '[]', '{}')$$),
  ('import_rows', 'update', $$update public.import_rows set warnings = warnings where tenant_id = '{T}'$$),
  ('import_rows', 'delete', $$delete from public.import_rows where tenant_id = '{T}'$$),
  ('templates', 'select', $$select 1 from public.templates where tenant_id = '{T}'$$),
  ('templates', 'insert', $$insert into public.templates (tenant_id, template_key, channel, locale, tone, subject, body) values ('{T}', 'new_key', 'email', 'en', 'neutral', 'S', 'B')$$),
  ('templates', 'update', $$update public.templates set body = body where tenant_id = '{T}'$$),
  ('templates', 'delete', $$delete from public.templates where tenant_id = '{T}'$$),
  ('channel_accounts', 'select', $$select 1 from public.channel_accounts where tenant_id = '{T}'$$),
  ('channel_accounts', 'insert', $$insert into public.channel_accounts (tenant_id, channel, config) values ('{T}', 'sms', '{}')$$),
  ('channel_accounts', 'update', $$update public.channel_accounts set enabled = enabled where tenant_id = '{T}'$$),
  ('channel_accounts', 'delete', $$delete from public.channel_accounts where tenant_id = '{T}'$$),
  ('customer_consents', 'select', $$select 1 from public.customer_consents where tenant_id = '{T}'$$),
  ('customer_consents', 'insert', $$insert into public.customer_consents (tenant_id, customer_id, channel, granted_at, source) values ('{T}', '{FREE}', 'sms', now(), 'form')$$),
  ('customer_consents', 'update', $$update public.customer_consents set source = source where tenant_id = '{T}'$$),
  ('customer_consents', 'delete', $$delete from public.customer_consents where tenant_id = '{T}'$$),
  ('approvals', 'select', $$select 1 from public.approvals where tenant_id = '{T}'$$),
  ('approvals', 'insert', $$insert into public.approvals (tenant_id, invoice_id, idempotency_key, step_id, channel, requested_at) values ('{T}', '{INV}', 'x:s9:email', 's9', 'email', now())$$),
  ('approvals', 'update', $$update public.approvals set status = 'approved' where tenant_id = '{T}'$$),
  ('approvals', 'delete', $$delete from public.approvals where tenant_id = '{T}'$$),
  ('dead_letters', 'select', $$select 1 from public.dead_letters where tenant_id = '{T}'$$),
  ('dead_letters', 'insert', $$insert into public.dead_letters (tenant_id, source, reason, attempts) values ('{T}', 'followup_actions', 'x', 1)$$),
  ('dead_letters', 'update', $$update public.dead_letters set reason = reason where tenant_id = '{T}'$$),
  ('dead_letters', 'delete', $$delete from public.dead_letters where tenant_id = '{T}'$$),
  ('notifications', 'select', $$select 1 from public.notifications where tenant_id = '{T}'$$),
  ('notifications', 'insert', $$insert into public.notifications (tenant_id, dedupe_key, period, kind, created_at) values ('{T}', 'k', 'p', 'x', now())$$),
  ('notifications', 'update', $$update public.notifications set kind = kind where tenant_id = '{T}'$$),
  ('notifications', 'delete', $$delete from public.notifications where tenant_id = '{T}'$$),
  ('invoice_balances', 'select', $$select 1 from public.invoice_balances where tenant_id = '{T}'$$),
  ('invoices_due', 'select', $$select 1 from public.invoices_due where tenant_id = '{T}'$$);

-- ADR 0008, own-tenant cells (written independently of the policies).
create temp table expected (tbl text, op text, owner text, accountant text, collector text, primary key (tbl, op)) on commit drop;
insert into expected values
  ('tenants', 'select', 'allow', 'allow', 'allow'),
  ('tenants', 'insert', 'deny', 'deny', 'deny'),
  ('tenants', 'update', 'allow', 'deny', 'deny'),
  ('tenants', 'delete', 'deny', 'deny', 'deny'),
  ('memberships', 'select', 'allow', 'allow', 'allow'),
  ('memberships', 'insert', 'allow', 'deny', 'deny'),
  ('memberships', 'update', 'allow', 'deny', 'deny'),
  ('memberships', 'delete', 'allow', 'deny', 'deny'),
  ('customers', 'select', 'allow', 'allow', 'allow'),
  ('customers', 'insert', 'allow', 'allow', 'deny'),
  ('customers', 'update', 'allow', 'allow', 'deny'),
  ('customers', 'delete', 'allow', 'deny', 'deny'),
  ('policies', 'select', 'allow', 'allow', 'allow'),
  ('policies', 'insert', 'allow', 'allow', 'deny'),
  ('policies', 'update', 'allow', 'allow', 'deny'),
  ('policies', 'delete', 'allow', 'allow', 'deny'),
  ('holidays', 'select', 'allow', 'allow', 'allow'),
  ('holidays', 'insert', 'allow', 'allow', 'deny'),
  ('holidays', 'update', 'allow', 'allow', 'deny'),
  ('holidays', 'delete', 'allow', 'allow', 'deny'),
  ('invoices', 'select', 'allow', 'allow', 'allow'),
  ('invoices', 'insert', 'allow', 'allow', 'deny'),
  ('invoices', 'update', 'allow', 'allow', 'deny'),
  ('invoices', 'delete', 'deny', 'deny', 'deny'),
  ('invoice_events', 'select', 'allow', 'allow', 'allow'),
  ('invoice_events', 'insert', 'deny', 'deny', 'deny'),
  ('invoice_events', 'update', 'deny', 'deny', 'deny'),
  ('invoice_events', 'delete', 'deny', 'deny', 'deny'),
  ('messages', 'select', 'allow', 'allow', 'allow'),
  ('messages', 'insert', 'deny', 'deny', 'deny'),
  ('messages', 'update', 'deny', 'deny', 'deny'),
  ('messages', 'delete', 'deny', 'deny', 'deny'),
  ('message_invoices', 'select', 'allow', 'allow', 'allow'),
  ('message_invoices', 'insert', 'deny', 'deny', 'deny'),
  ('message_invoices', 'update', 'deny', 'deny', 'deny'),
  ('message_invoices', 'delete', 'deny', 'deny', 'deny'),
  ('payments', 'select', 'allow', 'allow', 'allow'),
  ('payments', 'insert', 'deny', 'deny', 'deny'),
  ('payments', 'update', 'deny', 'deny', 'deny'),
  ('payments', 'delete', 'deny', 'deny', 'deny'),
  ('import_batches', 'select', 'allow', 'allow', 'deny'),
  ('import_batches', 'insert', 'allow', 'allow', 'deny'),
  ('import_batches', 'update', 'deny', 'deny', 'deny'),
  ('import_batches', 'delete', 'deny', 'deny', 'deny'),
  ('import_rows', 'select', 'allow', 'allow', 'deny'),
  ('import_rows', 'insert', 'allow', 'allow', 'deny'),
  ('import_rows', 'update', 'deny', 'deny', 'deny'),
  ('import_rows', 'delete', 'deny', 'deny', 'deny'),
  -- ADR 0012 (prompt 3 tables)
  ('templates', 'select', 'allow', 'allow', 'allow'),
  ('templates', 'insert', 'allow', 'allow', 'deny'),
  ('templates', 'update', 'allow', 'allow', 'deny'),
  ('templates', 'delete', 'allow', 'deny', 'deny'),
  ('channel_accounts', 'select', 'allow', 'allow', 'allow'),
  ('channel_accounts', 'insert', 'allow', 'deny', 'deny'),
  ('channel_accounts', 'update', 'allow', 'deny', 'deny'),
  ('channel_accounts', 'delete', 'allow', 'deny', 'deny'),
  ('customer_consents', 'select', 'allow', 'allow', 'allow'),
  ('customer_consents', 'insert', 'allow', 'allow', 'deny'),
  ('customer_consents', 'update', 'allow', 'allow', 'deny'),
  ('customer_consents', 'delete', 'deny', 'deny', 'deny'),
  ('approvals', 'select', 'allow', 'allow', 'allow'),
  ('approvals', 'insert', 'deny', 'deny', 'deny'),
  ('approvals', 'update', 'deny', 'deny', 'deny'),
  ('approvals', 'delete', 'deny', 'deny', 'deny'),
  ('dead_letters', 'select', 'allow', 'allow', 'deny'),
  ('dead_letters', 'insert', 'deny', 'deny', 'deny'),
  ('dead_letters', 'update', 'deny', 'deny', 'deny'),
  ('dead_letters', 'delete', 'deny', 'deny', 'deny'),
  ('notifications', 'select', 'allow', 'allow', 'deny'),
  ('notifications', 'insert', 'deny', 'deny', 'deny'),
  ('notifications', 'update', 'deny', 'deny', 'deny'),
  ('notifications', 'delete', 'deny', 'deny', 'deny'),
  ('invoice_balances', 'select', 'allow', 'allow', 'allow'),
  ('invoices_due', 'select', 'allow', 'allow', 'allow');

create temp table targets (tenant text, t uuid, cust uuid, free uuid, pol uuid, inv uuid, msg uuid, batch uuid, cur text, member uuid) on commit drop;
insert into targets values
  ('A', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-0000000000fa',
   '00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000001aa', '00000000-0000-0000-0000-0000000000ea',
   '00000000-0000-0000-0000-0000000003aa', 'GBP', '00000000-0000-0000-0000-0000000000a3'),
  ('B', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-0000000000fb',
   '00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-0000000001bb', '00000000-0000-0000-0000-0000000000eb',
   '00000000-0000-0000-0000-0000000003bb', 'PKR', '00000000-0000-0000-0000-0000000000b1');

create temp table actors (name text, id uuid, role text) on commit drop;
insert into actors values
  ('owner of A', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('accountant of A', '00000000-0000-0000-0000-0000000000a2', 'accountant'),
  ('collector of A', '00000000-0000-0000-0000-0000000000a3', 'collector'),
  ('non-member', '00000000-0000-0000-0000-0000000000c1', null),
  ('anon', null, null);

create temp table cases on commit drop as
select
  o.tbl, o.op, tg.tenant, a.name as actor, a.id as actor_id,
  replace(replace(replace(replace(replace(replace(replace(replace(replace(o.stmt,
    '{T}', tg.t::text), '{CUST}', tg.cust::text), '{FREE}', tg.free::text), '{POL}', tg.pol::text),
    '{INV}', tg.inv::text), '{MSG}', tg.msg::text), '{BATCH}', tg.batch::text), '{CUR}', tg.cur),
    '{MEMBER}', tg.member::text) as stmt,
  case
    when tg.tenant = 'B' or a.role is null then 'deny'
    when a.role = 'owner' then e.owner
    when a.role = 'accountant' then e.accountant
    else e.collector
  end as want
from ops o
join expected e using (tbl, op)
cross join targets tg
cross join actors a;

select plan((select count(*)::int + 2 from cases));

select is((select count(*)::int from ops), (select count(*)::int from expected), 'every statement has an expected matrix cell');
select is(
  (select count(distinct tbl)::int from ops where tbl not in ('invoice_balances', 'invoices_due')),
  (select count(*)::int from pg_tables where schemaname = 'public'),
  'the matrix covers every table in public'
);

select is(
  pg_temp.outcome(pg_temp.try_as(c.actor_id, c.stmt)),
  c.want,
  format('%s: %s %s on tenant %s rows', c.actor, c.op, c.tbl, c.tenant)
)
from cases c
order by c.tbl, c.op, c.tenant, c.actor;

select * from finish();
rollback;
