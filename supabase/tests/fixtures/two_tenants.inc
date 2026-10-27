-- Shared fixture (included with \ir; not a test file). Runs as postgres inside the
-- caller's transaction, which always ends in rollback.
-- Tenants A and B, one customer and one invoice each.
insert into public.tenants (id, name, timezone, currency) values
  ('00000000-0000-0000-0000-00000000000a', 'Tenant A', 'Europe/London', 'GBP'),
  ('00000000-0000-0000-0000-00000000000b', 'Tenant B', 'Asia/Karachi', 'PKR');

insert into public.customers (id, tenant_id, display_name) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-00000000000a', 'Customer A'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-00000000000b', 'Customer B');

insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code) values
  ('00000000-0000-0000-0000-0000000001aa', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca',
   'A-1', 10000, 'GBP', '2026-01-01', '2026-02-01', 'REFAAAA1'),
  ('00000000-0000-0000-0000-0000000001bb', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000cb',
   'B-1', 50000, 'PKR', '2026-01-01', '2026-02-01', 'REFBBBB1');
