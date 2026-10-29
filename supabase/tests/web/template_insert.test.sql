-- Migration 0024: the provider status of a template is set by an owner (set_template_provider_status) after the
-- provider approved the text. 0020 guarded UPDATEs only, so an accountant could INSERT a WhatsApp template that
-- was already 'approved' straight through the API (found while adding the "New WhatsApp template" form, round 1).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../fixtures/rls_world.inc
select plan(8);

create function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p::text, true);
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated, anon;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
insert into public.templates (id, tenant_id, template_key, channel, locale, tone, body, provider_template_name, provider_language, provider_status)
  values ('00000000-0000-0000-0000-0000000008aa', '00000000-0000-0000-0000-00000000000a', 'nudge', 'whatsapp', 'en', 'neutral', 'Hello {{customer_name}}', 'nudge_v1', 'en', 'approved');
insert into public.templates (id, tenant_id, template_key, channel, locale, tone, subject, body, provider_status)
  values ('00000000-0000-0000-0000-0000000008ab', '00000000-0000-0000-0000-00000000000a', 'nudge', 'email', 'en', 'neutral', 'Hi', 'Hello {{customer_name}}', 'approved');
reset role;
select is((select provider_status from public.templates where id = '00000000-0000-0000-0000-0000000008aa'), 'pending', 'an accountant''s new WhatsApp template starts pending, whatever the client sent');
select is((select provider_status from public.templates where id = '00000000-0000-0000-0000-0000000008ab'), null, 'an email template has no provider status');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.set_template_provider_status('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000008aa', 'approved')$$, 'the owner approves it through the RPC');
reset role;
select is((select provider_status from public.templates where id = '00000000-0000-0000-0000-0000000008aa'), 'approved', 'and then it is approved');

-- Migration 0025 (review round 2): swapping WHAT is sent behind an approved template also needs a new approval.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
update public.templates set provider_template_name = 'other_template' where id = '00000000-0000-0000-0000-0000000008aa';
reset role;
select is((select provider_status from public.templates where id = '00000000-0000-0000-0000-0000000008aa'), 'needs_resubmission', 'changing the Meta template name of an approved template needs a new approval');
update public.templates set provider_status = 'approved' where id = '00000000-0000-0000-0000-0000000008aa';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
update public.templates set provider_language = 'de' where id = '00000000-0000-0000-0000-0000000008aa';
reset role;
select is((select provider_status from public.templates where id = '00000000-0000-0000-0000-0000000008aa'), 'needs_resubmission', 'so does changing its Meta language');
update public.templates set provider_status = 'approved' where id = '00000000-0000-0000-0000-0000000008aa';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a2');
update public.templates set template_key = 'firm' where id = '00000000-0000-0000-0000-0000000008aa';
reset role;
select is((select provider_status from public.templates where id = '00000000-0000-0000-0000-0000000008aa'), 'needs_resubmission', 'and moving it to another step key');

-- Trusted code (seed, demo, migrations) is not affected.
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
insert into public.templates (id, tenant_id, template_key, channel, locale, tone, body, provider_template_name, provider_language, provider_status)
  values ('00000000-0000-0000-0000-0000000008ac', '00000000-0000-0000-0000-00000000000a', 'trusted_check', 'whatsapp', 'en', 'firm', 'Hello', 'firm_v1', 'en', 'approved');
select is((select provider_status from public.templates where id = '00000000-0000-0000-0000-0000000008ac'), 'approved', 'a trusted insert keeps its status');

select * from finish();
rollback;
