-- Prompt 6 Part B (migration 0020): service-only public links / rate limits / idempotency, API keys, policy save
-- (issue K), template edit rule (issue L), settings, 'web' channel.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(34);

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p::text, true);
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated, anon;

-- ---- service-only objects: no API role can touch them ----
insert into public.public_links (tenant_id, purpose, invoice_id, customer_id, token_hash, expires_at)
  values ('00000000-0000-0000-0000-00000000000a', 'pay', '00000000-0000-0000-0000-0000000001aa', '00000000-0000-0000-0000-0000000000ca', repeat('a', 64), now() + interval '1 day');
select throws_ok($$insert into public.public_links (tenant_id, purpose, invoice_id, customer_id, token_hash, expires_at)
  values ('00000000-0000-0000-0000-00000000000a', 'opt_out', '00000000-0000-0000-0000-0000000001aa', '00000000-0000-0000-0000-0000000000ca', repeat('b', 64), now() + interval '1 day')$$,
  '23514', null, 'an opt_out link has no invoice (purposes are distinct shapes)');
select is((select count(*)::int from private.resolve_public_link(repeat('a', 64), 'pay', now())), 1, 'a valid pay token resolves');
select is((select count(*)::int from private.resolve_public_link(repeat('a', 64), 'opt_out', now())), 0, 'A: a pay token is not an opt-out token');
select is((select count(*)::int from private.resolve_public_link(repeat('a', 64), 'pay', now() + interval '2 days')), 0, 'an expired token resolves to nothing');
update public.public_links set revoked_at = now() where token_hash = repeat('a', 64);
select is((select count(*)::int from private.resolve_public_link(repeat('a', 64), 'pay', now())), 0, 'a revoked token resolves to nothing');
select ok(private.rate_limit_hit('t:1', 60, 2, now()) and private.rate_limit_hit('t:1', 60, 2, now()) and not private.rate_limit_hit('t:1', 60, 2, now()), 'P: the third hit in a window of 2 is refused');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select * from public.public_links$$, '42501', null, 'owners cannot read public_links');
select throws_ok($$select * from private.rate_limits$$, '42501', null, 'nor the rate-limit counters (private schema)');
select throws_ok($$select * from public.api_idempotency$$, '42501', null, 'nor api_idempotency');
select throws_ok($$select * from private.resolve_public_link(repeat('a', 64), 'pay', now())$$, '42501', null, 'resolve_public_link is not executable by authenticated');
select throws_ok($$select private.pay_page(gen_random_uuid())$$, '42501', null, 'pay_page is not executable by authenticated');
select throws_ok($$select private.rate_limit_hit('x', 60, 1, now())$$, '42501', null, 'rate_limit_hit is not executable by authenticated');
reset role;
set local role anon;
select throws_ok($$select * from private.resolve_public_link(repeat('a', 64), 'pay', now())$$, '42501', null, 'nor by anon');
reset role;

-- ---- API keys ----
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select ok(public.create_api_key('00000000-0000-0000-0000-00000000000a', 'ERP') ~ '^dl_[a-z0-9]{8}_[A-Za-z0-9_-]{43,44}$', 'O: the owner gets a key in the documented shape, once');
select is((select count(*)::int from public.api_keys where tenant_id = '00000000-0000-0000-0000-00000000000a'), 1, 'the owner sees the key metadata');
select throws_ok($$select secret_hash from public.api_keys$$, '42501', null, 'N: the hash column is not selectable');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.create_api_key('00000000-0000-0000-0000-00000000000a', 'x')$$, '42501', null, 'an accountant cannot create keys');
select is((select count(*)::int from public.api_keys), 0, 'an accountant cannot see keys');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.revoke_api_key('00000000-0000-0000-0000-00000000000a', (select id from public.api_keys limit 1))$$, '42501', null, 'another tenant''s owner cannot revoke');
reset role;

-- ---- policy save (issue K) ----
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true); -- back to a trusted session
update public.policies set steps = '[{"id": "s1", "daysAfterDue": 1, "channel": "email", "templateKey": "friendly"}]', is_default = true
  where id = '00000000-0000-0000-0000-0000000000da';
update public.invoices set status = 'overdue', next_action_at = 'infinity' where id = '00000000-0000-0000-0000-0000000001aa';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.save_policy('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', 'P', '[{"id": "s1", "daysAfterDue": 2, "channel": "email", "templateKey": "friendly"}]', 21, 1, 3)$$,
  '42501', null, 'a collector cannot edit policies');
update public.policies set steps = '[]' where id = '00000000-0000-0000-0000-0000000000da'; -- RLS: no row is writable for a collector
select is((select jsonb_array_length(steps) from public.policies where id = '00000000-0000-0000-0000-0000000000da'), 1, 'K: a collector cannot change steps (RLS filters the row)');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$update public.policies set steps = '[]' where id = '00000000-0000-0000-0000-0000000000da'$$, '42501', null, 'K: not even an accountant, directly');
select throws_ok($$select public.save_policy('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', 'P', '[{"id": "s9", "daysAfterDue": 2, "channel": "email", "templateKey": "friendly"}]', 21, 1, 3)$$,
  '22023', null, 'K: an invented step id is refused');
create temp table saved (r jsonb) on commit drop;
grant all on saved to authenticated;
insert into saved select public.save_policy('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', 'Policy A',
  '[{"id": "s1", "daysAfterDue": 2, "channel": "email", "templateKey": "friendly"}, {"id": null, "daysAfterDue": 7, "channel": "email", "templateKey": "firm"}]', 21, 1, 3);
reset role;
select is((select (r -> 'steps' -> 0 ->> 'id') from saved), 's1', 'K: an existing step keeps its id');
select ok((select (r -> 'steps' -> 1 ->> 'id') ~ '^s_[0-9a-f]{10}$' from saved), 'K: a new step gets a system id');
select ok((select (r ->> 'refreshed')::int >= 1 from saved), 'K: open invoices of the policy are refreshed in the same transaction');
select ok((select next_action_at < 'infinity' from public.invoices where id = '00000000-0000-0000-0000-0000000001aa'), 'K: next_action_at moved to now');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.save_policy('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000da', 'Policy A', '[{"id": "s1", "daysAfterDue": 3, "channel": "email", "templateKey": "friendly"}]', 21, 1, 3)$$, 'a step can be removed');
reset role;
select ok((select retired_step_ids <> '{}' from public.policies where id = '00000000-0000-0000-0000-0000000000da'), 'K: the removed id is retired (never reused)');

-- ---- templates (issue L) ----
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
insert into public.templates (id, tenant_id, template_key, channel, locale, tone, body, provider_template_name, provider_language, provider_status)
  values ('00000000-0000-0000-0000-0000000007aa', '00000000-0000-0000-0000-00000000000a', 'nudge', 'whatsapp', 'en', 'neutral', 'Hello {{customer_name}}', 'nudge_v1', 'en', 'approved');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
update public.templates set body = 'Hello {{customer_name}}, please pay' where id = '00000000-0000-0000-0000-0000000007aa';
select is((select provider_status from public.templates where id = '00000000-0000-0000-0000-0000000007aa'), 'needs_resubmission', 'L: editing an approved WhatsApp body requires resubmission');
select throws_ok($$update public.templates set provider_status = 'approved' where id = '00000000-0000-0000-0000-0000000007aa'$$, '42501', null, 'L: an accountant cannot mark it approved');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_template_provider_status('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000007aa', 'approved')$$, 'L: the owner can, through the RPC');
reset role;

-- ---- settings + web channel ----
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
select throws_ok($$select public.save_tenant_settings('00000000-0000-0000-0000-00000000000a', '{"approval_mode": "never"}')$$, '42501', null, 'settings are owner-only');
reset role;
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select throws_ok($$insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key, send_state) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000ca', 'web', 'out', 'web-out', 'pending')$$,
  '23514', null, 'the web channel is inbound only (nothing is ever sent on it)');

select * from finish();
rollback;
