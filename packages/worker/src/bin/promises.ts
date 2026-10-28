// pnpm promises list [--tenant <t>] [--status active|kept|broken|superseded|cancelled|all]
//               cancel <id> [--note "..."]
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { openDb, resolveTenant } from '../runtime.ts';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { tenant: { type: 'string' }, status: { type: 'string', default: 'active' }, note: { type: 'string' } } });
const [cmd, id] = positionals;
const db = openDb(process.env);

try {
  if (cmd === 'list') {
    const tenant = values.tenant ? await resolveTenant(db, values.tenant) : null;
    const r = await db.pool.query(
      `select p.id, t.name as tenant, i.number as invoice, p.promised_on::text, p.status, p.reference_at, p.resolved_by
       from public.promises p join public.tenants t on t.id = p.tenant_id join public.invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
       where ($1::uuid is null or p.tenant_id = $1) and ($2 = 'all' or p.status = $2) order by p.created_at`,
      [tenant, values.status],
    );
    console.table(r.rows);
  } else if (cmd === 'cancel' && id) {
    const r = await db.pool.query<{ r: string }>('select private.cancel_promise_impl($1, $2, $3, now()) as r', [id, values.note ?? null, `cli:${userInfo().username}`.slice(0, 100)]);
    console.log(JSON.stringify({ id, result: r.rows[0]?.r }));
  } else {
    console.error('usage: pnpm promises list [--tenant] [--status] | cancel <id> [--note]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : 'failed');
  process.exitCode = 1;
} finally {
  await db.pool.end();
}
