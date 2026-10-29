-- Templates (issue L, after review round 1): 0020 guarded UPDATEs only, so a member with insert rights (owner or
-- accountant, RLS) could create a WhatsApp template that was already 'approved' and skip the owner's
-- set_template_provider_status. On a direct client INSERT the status is decided here: WhatsApp starts 'pending',
-- other channels have none. Trusted code (seed, demo, migrations) is unaffected, like guard_template_edit.
-- SECURITY INVOKER for the same reason as guard_template_edit: only direct client writes are guarded.
create function private.guard_template_insert() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  new.provider_status := case when new.channel = 'whatsapp' then 'pending' else null end;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.guard_template_insert() from public, anon;
grant execute on function private.guard_template_insert() to authenticated;
create trigger templates_guard_insert before insert on public.templates for each row execute function private.guard_template_insert();
