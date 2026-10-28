// pnpm approvals list [--tenant <t>] [--status pending]
//                   approve <id> | approve --all-pending --tenant <t>
//                   reject <id> [--note <text>]
//                   edit <id> --subject <s> --body <b>
// Approving never sends: the invoice re-enters the pipeline and decide() + every gate run again (rule 16).
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { openDb, resolveTenant } from '../runtime.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tenant: { type: 'string' },
    status: { type: 'string', default: 'pending' },
    'all-pending': { type: 'boolean', default: false },
    note: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
  },
});
const [cmd, id] = positionals;
const actor = `cli:${userInfo().username}`.slice(0, 100);
const db = openDb(process.env);

async function decide(approvalId: string, decision: 'approve' | 'reject'): Promise<string> {
  const r = await db.pool.query<{ r: string }>('select private.decide_approval_impl($1, $2, $3, $4, now()) as r', [approvalId, decision, values.note ?? null, actor]);
  return r.rows[0]?.r ?? 'unknown';
}

try {
  if (cmd === 'list') {
    const tenant = values.tenant ? await resolveTenant(db, values.tenant) : null;
    const r = await db.pool.query(
      `select a.id, t.name as tenant, i.number as invoice, a.step_id as step, a.channel, a.status, a.version, a.requested_at
       from public.approvals a join public.invoices i on i.tenant_id = a.tenant_id and i.id = a.invoice_id
       join public.tenants t on t.id = a.tenant_id
       where ($1::uuid is null or a.tenant_id = $1) and ($2 = 'all' or a.status = $2)
       order by a.requested_at, i.number`,
      [tenant, values.status],
    );
    console.table(r.rows);
  } else if (cmd === 'approve' && values['all-pending']) {
    if (!values.tenant) throw new Error('--all-pending needs --tenant (never across all tenants at once)');
    const tenant = await resolveTenant(db, values.tenant);
    const r = await db.pool.query<{ id: string }>(`select id from public.approvals where tenant_id = $1 and status = 'pending' order by requested_at`, [tenant]);
    const results: Record<string, number> = {};
    for (const row of r.rows) {
      const out = await decide(row.id, 'approve');
      results[out] = (results[out] ?? 0) + 1;
    }
    console.log(JSON.stringify({ approvals: r.rows.length, results }));
  } else if ((cmd === 'approve' || cmd === 'reject') && id) {
    console.log(JSON.stringify({ id, result: await decide(id, cmd) }));
  } else if (cmd === 'edit' && id && (values.subject !== undefined || values.body !== undefined)) {
    await db.pool.query('select private.edit_approval_impl($1, $2, $3)', [id, values.subject ?? null, values.body ?? null]);
    console.log(JSON.stringify({ id, result: 'edited' }));
  } else {
    console.error('usage: pnpm approvals list | approve <id> | approve --all-pending --tenant <t> | reject <id> [--note] | edit <id> --subject --body');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : 'failed');
  process.exitCode = 1;
} finally {
  await db.pool.end();
}
