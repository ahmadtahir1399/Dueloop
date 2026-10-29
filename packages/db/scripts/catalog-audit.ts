// pnpm db:catalog-audit: the database half of the security review (prompt 7 step 8b), by SQL against the local stack.
//   - public tables without RLS                    - write policies without WITH CHECK
//   - SECURITY DEFINER functions anon/authenticated can execute (public and private schemas)
//   - views in public that are not security_invoker (they would bypass RLS)
//   - public Storage buckets                       - default privileges that grant to anon/authenticated
// Prints every finding with a verdict; exit 1 when an UNEXPECTED finding appears (the expected ones are listed with
// the reason they are acceptable, so a new one cannot hide among them).
import pg from 'pg';
import { localEnv } from './local-env.ts';

/**
 * Reviewed and accepted, each with the reason (docs/security-review.md, catalog audit). Matched by check + object
 * pattern; anything else fails the audit, so a new finding cannot hide among accepted ones.
 */
const IMPL_RPCS = /^private\.(audit_export|cancel_promise|commit_import_batch|create_api_key|create_tenant|decide_approval|edit_approval|list_members|log_list_export|remove_member|resolve_task|revoke_api_key|save_policy|save_tenant_settings|set_member_role|set_outbound_paused|set_template_provider_status)_impl\(/;
const ACCEPTED: { check: string; object: RegExp; reason: string }[] = [
  {
    check: 'SECURITY DEFINER executable by an API role',
    object: IMPL_RPCS,
    reason: 'called only through a security-invoker wrapper in public; `private` is not exposed by the API (config.toml schemas); re-checks role + tenant inside (pgTAP role_matrix / staff_rpcs)',
  },
  { check: 'SECURITY DEFINER executable by an API role', object: /^private\.is_globally_paused_impl\(/, reason: 'returns only the global kill-switch flag (no tenant data)' },
  { check: 'SECURITY DEFINER executable by an API role', object: /^private\.(my_tenant_ids|require_owner)\(/, reason: 'RLS helpers: definer to avoid policy recursion; answer only about the caller (auth.uid())' },
  {
    check: 'default privileges to API roles',
    object: /^(supabase_admin in (public|graphql_public|graphql|supabase_functions)|postgres in storage) /,
    reason: 'Supabase platform defaults for objects those roles create; our migrations run as postgres, every public table has RLS (rls-check) and functions are revoked explicitly',
  },
];
const accepted = (f: { check: string; object: string }) => ACCEPTED.find((a) => a.check === f.check && a.object.test(f.object))?.reason;

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL ?? localEnv().dbUrl, max: 1 });
  const q = async <R extends pg.QueryResultRow>(sql: string) => (await pool.query<R>(sql)).rows;
  const findings: { check: string; object: string; detail: string }[] = [];
  try {
    for (const r of await q<{ t: string }>(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`))
      findings.push({ check: 'table without RLS', object: `public.${r.t}`, detail: 'RLS disabled' });

    for (const r of await q<{ t: string; p: string; cmd: string }>(`select tablename as t, policyname as p, cmd from pg_policies where schemaname = 'public' and cmd in ('INSERT', 'ALL') and with_check is null`))
      findings.push({ check: 'write policy without WITH CHECK', object: `public.${r.t} / ${r.p}`, detail: `${r.cmd} policy with no WITH CHECK` });

    for (const r of await q<{ f: string; role: string }>(
      `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f, r.rolname as role
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
       where p.prosecdef and n.nspname in ('public', 'private') and has_function_privilege(r.rolname, p.oid, 'execute') order by 1, 2`,
    ))
      findings.push({ check: 'SECURITY DEFINER executable by an API role', object: r.f, detail: r.role });

    for (const r of await q<{ v: string }>(
      `select c.relname as v from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v' and not coalesce('security_invoker=true' = any (c.reloptions) or 'security_invoker=on' = any (c.reloptions), false)`,
    ))
      findings.push({ check: 'view without security_invoker', object: `public.${r.v}`, detail: 'runs with the owner\'s rights (bypasses RLS)' });

    for (const r of await q<{ id: string }>(`select id from storage.buckets where public`)) findings.push({ check: 'public storage bucket', object: r.id, detail: 'objects readable without a token' });

    for (const r of await q<{ owner: string; schema: string; kind: string; acl: string }>(
      `select pg_get_userbyid(d.defaclrole) as owner, coalesce(n.nspname, '*') as schema, d.defaclobjtype as kind, d.defaclacl::text as acl
       from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace where d.defaclacl::text ~ '(anon|authenticated)='`,
    ))
      findings.push({ check: 'default privileges to API roles', object: `${r.owner} in ${r.schema} (${r.kind})`, detail: r.acl });
  } finally {
    await pool.end();
  }
  const unexpected = findings.filter((f) => !accepted(f));
  console.table(findings.map((f) => ({ check: f.check, object: f.object.slice(0, 70), verdict: accepted(f) ? 'accepted (reason in script)' : 'REVIEW' })));
  console.log(`${findings.length} finding(s), ${unexpected.length} not yet accepted`);
  process.exitCode = unexpected.length ? 1 : 0;
}

await main();
