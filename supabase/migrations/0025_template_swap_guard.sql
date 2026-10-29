-- Templates (review round 2): guard_template_edit (0020) asked for a new approval only when the body or subject of a
-- WhatsApp template changed. The worker sends by provider_template_name / provider_language, so a member could
-- swap the Meta template behind an approved row (or move it to another step key, locale or channel) and send
-- text no owner approved. Any change to WHAT is sent, or WHERE it is used, now needs a new approval.
create or replace function private.guard_template_edit() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.provider_status is distinct from old.provider_status then
    raise exception using errcode = '42501', message = 'the provider status is set by an owner after the provider approved the text';
  end if;
  if (new.channel = 'whatsapp' or old.channel = 'whatsapp') and (
    new.body is distinct from old.body or new.subject is distinct from old.subject
    or new.provider_template_name is distinct from old.provider_template_name
    or new.provider_language is distinct from old.provider_language
    or new.template_key is distinct from old.template_key
    or new.locale is distinct from old.locale
    or new.channel is distinct from old.channel
  ) then
    new.provider_status := case when new.channel = 'whatsapp' then 'needs_resubmission' else null end;
  end if;
  new.updated_at := now();
  return new;
end $$;
