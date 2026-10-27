// pnpm db:rls-check -> exit 1 if any table in public lacks RLS (or any public view is not security_invoker).
import pg from 'pg';
import { localEnv } from './local-env.ts';

export async function findUnprotected(dbUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string; problem: string }>(`
      select c.relname as name, 'table without row level security' as problem
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
      union all
      select c.relname, 'view without security_invoker'
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and not coalesce('security_invoker=true' = any (c.reloptions), false)
      order by 1`);
    return rows.map((r) => `public.${r.name}: ${r.problem}`);
  } finally {
    await client.end();
  }
}

const problems = await findUnprotected(localEnv().dbUrl);
if (problems.length > 0) {
  console.error(`RLS check FAILED (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('RLS check passed: every public table has RLS and every public view is security_invoker.');
}
