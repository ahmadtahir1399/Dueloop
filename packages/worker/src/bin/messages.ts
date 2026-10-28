// pnpm messages unknown [--tenant <t>]
//                  resolve <messageId> --as sent|not_sent
//                  unpark <invoiceId>
// A message in an unknown state is never resent automatically (rule 17): a human checks the provider (or the
// customer) and records what really happened here.
import { parseArgs } from 'node:util';
import { reconcileMessage } from '../process.ts';
import { buildDeps, clockFrom, openDb, resolveTenant } from '../runtime.ts';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { tenant: { type: 'string' }, as: { type: 'string' } } });
const [cmd, id] = positionals;
const db = openDb(process.env);

try {
  if (cmd === 'unknown') {
    const tenant = values.tenant ? await resolveTenant(db, values.tenant) : null;
    const r = await db.pool.query(
      `select m.id, t.name as tenant, i.number as invoice, m.idempotency_key as key, m.channel, m.pending_since, i.parked_reason
       from public.messages m join public.message_invoices mi on mi.tenant_id = m.tenant_id and mi.message_id = m.id
       join public.invoices i on i.tenant_id = mi.tenant_id and i.id = mi.invoice_id join public.tenants t on t.id = m.tenant_id
       where m.send_state = 'unknown' and ($1::uuid is null or m.tenant_id = $1) order by m.pending_since`,
      [tenant],
    );
    console.table(r.rows);
  } else if (cmd === 'resolve' && id && (values.as === 'sent' || values.as === 'not_sent')) {
    // 'not_sent' lets the invoice re-enter decide(); the same step is then retried under the SAME key.
    const ok = await reconcileMessage(buildDeps(process.env, db, clockFrom(undefined)), id, values.as);
    if (!ok) throw new Error('not resolved: the message is not in the unknown state');
    console.log(JSON.stringify({ id, result: values.as }));
  } else if (cmd === 'unpark' && id) {
    const r = await db.pool.query<{ ok: boolean }>('select private.unpark_invoice($1, now()) as ok', [id]);
    console.log(JSON.stringify({ id, result: r.rows[0]?.ok ? 'unparked' : 'not_parked' }));
  } else {
    console.error('usage: pnpm messages unknown [--tenant] | resolve <messageId> --as sent|not_sent | unpark <invoiceId>');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : 'failed');
  process.exitCode = 1;
} finally {
  await db.pool.end();
}
