// pnpm import:twice -- <same arguments as pnpm run import>
// Runs the import CLI twice with identical arguments and fails (exit 1) unless the second run leaves
// the tenant's customers, invoices and invoice_events counts exactly as the first run left them.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { localEnv } from '../../db/scripts/local-env.ts';

const args = process.argv.slice(2).filter((a) => a !== '--');
const tenant = args[args.indexOf('--tenant') + 1];
if (!tenant || args.includes('--dry-run')) {
  console.error('usage: import-twice-check.ts --tenant <uuid> --file ... --mapping ... [--options ...] (no --dry-run)');
  process.exit(2);
}
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.ts');
const env = localEnv();
const childEnv = { ...process.env, SUPABASE_URL: env.apiUrl, SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey };

async function counts(): Promise<string> {
  const c = new pg.Client({ connectionString: env.dbUrl });
  await c.connect();
  try {
    const { rows } = await c.query<{ s: string }>(
      `select 'customers=' || (select count(*) from public.customers where tenant_id = $1)
           || ' invoices=' || (select count(*) from public.invoices where tenant_id = $1)
           || ' invoice_events=' || (select count(*) from public.invoice_events where tenant_id = $1) as s`,
      [tenant],
    );
    return rows[0]?.s ?? '';
  } finally {
    await c.end();
  }
}

const after: string[] = [];
console.log(`before:      ${await counts()}`);
for (const run of [1, 2]) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: childEnv });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`import run ${run} exited ${r.status}`);
    process.exit(1);
  }
  after.push(await counts());
  console.log(`after run ${run}: ${after.at(-1)}`);
}
if (after[0] !== after[1]) {
  console.error('NOT idempotent: the second import changed the counts');
  process.exit(1);
}
console.log('idempotent: the second import left customers, invoices and invoice_events unchanged');
