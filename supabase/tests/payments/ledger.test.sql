-- Prompt 5 ledger: append-only money, apply_payment's plan validation and idempotency, role checks,
-- integrity (and proof it can fail), storage isolation, event-store dedupe, one active request per invoice.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc

select plan(31);

-- A clean tenant C for ledger behaviour (the fixture world deliberately carries odd rows for RLS tests).
insert into public.tenants (id, name, timezone, currency) values ('00000000-0000-0000-0000-00000000000c', 'C', 'Europe/London', 'GBP');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c2', 'acct@c.test'), ('00000000-0000-0000-0000-0000000000c3', 'coll@c.test');
insert into public.memberships (tenant_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c2', 'accountant'),
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c3', 'collector');
insert into public.customers (id, tenant_id, display_name) values ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-00000000000c', 'Cust C');
insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code) values
  ('00000000-0000-0000-0000-0000000001c1', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000cc', 'C-1', 10000, 'GBP', '2026-01-01', '2026-02-01', 'REFCCCC1'),
  ('00000000-0000-0000-0000-0000000001c2', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000cc', 'C-2', 5000, 'GBP', '2026-01-01', '2026-02-01', 'REFCCCC2');
update public.invoices set status = 'overdue' where tenant_id = '00000000-0000-0000-0000-00000000000c';
insert into public.payment_requests (id, tenant_id, invoice_id, provider, provider_object_id, amount, currency, idempotency_key, created_at)
values ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000001c1', 'fake', 'plink_c1', 10000, 'GBP', 'req-c1', now());
insert into public.tasks (tenant_id, type, invoice_id, dedupe_key, created_at, blocks_reminders_until)
values ('00000000-0000-0000-0000-00000000000c', 'verify_payment_claim', '00000000-0000-0000-0000-0000000001c1', 'claim-c1', now(), now() + interval '3 days');
select pgmq.purge_queue('transactional_sends');

create function pg_temp.pay(inv uuid, status text, balance bigint, ref text, amount bigint, applied bigint, credit bigint, to_status text, source text default 'gateway', by_user uuid default null, events text[] default array['PaymentConfirmed'], tasks jsonb default '[]', send boolean default true)
returns jsonb language sql as $$
  select private.apply_payment(jsonb_build_object(
    'tenant_id', '00000000-0000-0000-0000-00000000000c', 'invoice_id', inv, 'expected_status', status, 'expected_balance', balance,
    'now', now(), 'request_id', '00000000-0000-0000-0000-0000000007c1',
    'receipt', jsonb_build_object('method', 'fake', 'source', source, 'provider_ref', ref, 'amount', amount, 'currency', 'GBP', 'received_at', now(), 'confirmed_by', by_user),
    'plan', jsonb_build_object('applied', applied, 'credit', credit, 'transition_to', to_status, 'promise_outcome', 'none', 'events', to_jsonb(events), 'tasks', tasks, 'send_receipt', send)))
$$;

-- Partial, then the rest: one paid transition, balance 0, ledger balanced, requests and claim task closed.
select is(pg_temp.pay('00000000-0000-0000-0000-0000000001c1', 'overdue', 10000, 'pi_1', 4000, 4000, 0, null, events => array['PartialPaymentConfirmed']) ->> 'result', 'applied', 'partial payment applied');
select is((select balance from public.invoice_balances where invoice_id = '00000000-0000-0000-0000-0000000001c1'), 6000::bigint, 'balance reduced');
select is((select status from public.payment_requests where id = '00000000-0000-0000-0000-0000000007c1'), 'deactivated', 'a partial payment retires the fixed-amount link (balance changed)');
select is(pg_temp.pay('00000000-0000-0000-0000-0000000001c1', 'overdue', 6000, 'pi_2', 6000, 6000, 0, 'paid') ->> 'result', 'applied', 'final payment applied');
select is((select status from public.invoices where id = '00000000-0000-0000-0000-0000000001c1'), 'paid', 'invoice paid');
select is((select count(*)::int from public.invoice_events where invoice_id = '00000000-0000-0000-0000-0000000001c1' and type = 'PaymentConfirmed'), 1, 'one PaymentConfirmed');
select is((select status from public.tasks where dedupe_key = 'claim-c1'), 'resolved', 'the "already paid" claim task is auto-resolved');
select is((select count(*)::int from pgmq.q_transactional_sends), 2, 'one receipt job per receipt, queued in the same transaction');

-- Idempotency: the same provider ref again is a no-op.
select is(pg_temp.pay('00000000-0000-0000-0000-0000000001c1', 'paid', 0, 'pi_2', 6000, 0, 6000, null) ->> 'result', 'duplicate', 'same (method, provider_ref) => duplicate, nothing applied');
select is((select count(*)::int from public.receipts where tenant_id = '00000000-0000-0000-0000-00000000000c'), 2, 'still two receipts');

-- Money for a final invoice: all credit, nothing applied, status unchanged.
select is(pg_temp.pay('00000000-0000-0000-0000-0000000001c1', 'paid', 0, 'pi_3', 2500, 0, 2500, null, events => array['PaymentCreditCreated'], tasks => '[{"type": "payment_on_final_invoice", "urgent": true}]', send => false) ->> 'result', 'applied', 'payment on a paid invoice is recorded');
select is((select c.amount from public.credits c join public.receipts r on r.id = c.receipt_id where r.provider_ref = 'pi_3'), 2500::bigint, '... entirely as credit');
select is((select urgent from public.tasks where type = 'payment_on_final_invoice' and tenant_id = '00000000-0000-0000-0000-00000000000c'), true, '... with an urgent task');

-- Overpayment on C-2: paid + credit.
select is(pg_temp.pay('00000000-0000-0000-0000-0000000001c2', 'overdue', 5000, 'pi_4', 7000, 5000, 2000, 'paid', events => array['PaymentConfirmed', 'PaymentCreditCreated'], tasks => '[{"type": "overpayment_credit", "urgent": false}]') ->> 'result', 'applied', 'overpayment applied');
select is((select balance from public.invoice_balances where invoice_id = '00000000-0000-0000-0000-0000000001c2'), 0::bigint, 'balance exactly 0, never negative');

-- The plan must be what the numbers force.
select throws_ok($$select pg_temp.pay('00000000-0000-0000-0000-0000000001c2', 'paid', 0, 'pi_5', 100, 100, 0, null)$$, '23514', null, 'applying money to a final invoice is rejected');
select is(pg_temp.pay('00000000-0000-0000-0000-0000000001c1', 'overdue', 10000, 'pi_6', 100, 100, 0, null) ->> 'result', 'replan', 'stale status/balance => replan, nothing written');
insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
values ('00000000-0000-0000-0000-0000000001c3', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000cc', 'C-3', 3000, 'GBP', '2026-01-01', '2026-02-01', 'REFCCCC3');
update public.invoices set status = 'overdue' where id = '00000000-0000-0000-0000-0000000001c3';
select throws_ok($$select pg_temp.pay('00000000-0000-0000-0000-0000000001c3', 'overdue', 3000, 'pi_7', 1000, 900, 100, null)$$, '23514', null, 'credit while balance remains is rejected');
select throws_ok($$select pg_temp.pay('00000000-0000-0000-0000-0000000001c3', 'overdue', 3000, 'pi_8', 3000, 3000, 0, null)$$, '23514', null, 'balance reaching 0 without the paid transition is rejected');
select throws_ok($$select pg_temp.pay('00000000-0000-0000-0000-0000000001c3', 'overdue', 3000, 'pi_9', 1000, 1000, 0, null, events => array['InvoiceWrittenOff'])$$, '22023', null, 'unexpected event types are rejected');

-- Humans: only owner/accountant may confirm (rule 27).
select throws_ok($$select pg_temp.pay('00000000-0000-0000-0000-0000000001c3', 'overdue', 3000, 'bank-1', 1000, 1000, 0, null, 'manual', '00000000-0000-0000-0000-0000000000c3', array['PartialPaymentConfirmed'])$$, '42501', null, 'a collector cannot confirm a payment');
select is(pg_temp.pay('00000000-0000-0000-0000-0000000001c3', 'overdue', 3000, 'bank-1', 1000, 1000, 0, null, 'manual', '00000000-0000-0000-0000-0000000000c2', array['PartialPaymentConfirmed']) ->> 'result', 'applied', 'an accountant can');

-- Append-only money.
select throws_ok($$update public.payments set amount = 1 where tenant_id = '00000000-0000-0000-0000-00000000000c'$$, '23514', null, 'payments: no UPDATE');
select throws_ok($$delete from public.receipts where tenant_id = '00000000-0000-0000-0000-00000000000c'$$, '23514', null, 'receipts: no DELETE');
select throws_ok($$update public.credits set amount = 1 where tenant_id = '00000000-0000-0000-0000-00000000000c'$$, '23514', null, 'credits: no UPDATE');

-- Integrity: clean for C, and it FAILS on a corrupted row (triggers off for the corruption only).
select is((select count(*)::int from private.payment_integrity('00000000-0000-0000-0000-00000000000c')), 0, 'integrity: no findings for tenant C');
set local session_replication_role = replica;
insert into public.credits (tenant_id, receipt_id, customer_id, invoice_id, amount, currency)
select tenant_id, id, customer_id, invoice_id, 1, currency from public.receipts where provider_ref = 'pi_1';
set local session_replication_role = origin;
select is((select finding from private.payment_integrity('00000000-0000-0000-0000-00000000000c')), 'receipt_unbalanced', 'integrity catches a receipt where received != applied + credit');

-- Storage: the bucket is private and reads are tenant-folder scoped.
insert into storage.objects (bucket_id, name) values ('payment-proofs', '00000000-0000-0000-0000-00000000000a/p1'), ('payment-proofs', '00000000-0000-0000-0000-00000000000b/p2');
select is((select public from storage.buckets where id = 'payment-proofs'), false, 'payment-proofs bucket is private');
select is(pg_temp.try_as('00000000-0000-0000-0000-0000000000a1', $$select 1 from storage.objects where bucket_id = 'payment-proofs'$$), 'ok:1', 'owner of A sees only A''s proof files');
select is(pg_temp.try_as('00000000-0000-0000-0000-0000000000a1', $$insert into storage.objects (bucket_id, name) values ('payment-proofs', '00000000-0000-0000-0000-00000000000a/x')$$), 'err:42501', 'no client role can upload proofs');

-- Store: a provider event id is stored once.
select ok(
  private.store_payment_event('00000000-0000-0000-0000-0000000005aa', 'fake', 'evt_dup', 'payment_failed', '{}', null, now()) is not null
  and private.store_payment_event('00000000-0000-0000-0000-0000000005aa', 'fake', 'evt_dup', 'payment_failed', '{}', null, now()) is null,
  'the same provider event id is stored exactly once'
);

select * from finish();
rollback;
