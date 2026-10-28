-- Prompt 6 step 4: the database-side role check used by the web app's trusted pipelines (manual payments, proof
-- decisions, unknown-message reconciliation). Those run on the trusted connection with the VERIFIED user id from
-- the session as the actor; this answers "does that user hold one of these roles in this tenant" from the
-- memberships table (rule 33: the UI hides, the DB decides). Not callable by any API role.
create function private.member_has_role(p_tenant uuid, p_user uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant and m.user_id = p_user and m.role = any (p_roles)
  )
$$;
revoke all on function private.member_has_role(uuid, uuid, text[]) from public, anon, authenticated, service_role;
