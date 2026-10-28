// pnpm tasks list [--tenant <t>] [--status open|resolved|all] [--type <type>]
//            show <id>
//            resolve <id> --note "<who did what and why>"
//            reopen <id> [--note "..."]
// Resolving records who (the OS user) and why. A resolved blocking task lets reminders resume at once.
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { openDb, resolveTenant } from '../runtime.ts';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { tenant: { type: 'string' }, status: { type: 'string', default: 'open' }, type: { type: 'string' }, note: { type: 'string' } } });
const [cmd, id] = positionals;
const actor = `cli:${userInfo().username}`.slice(0, 100);
const db = openDb(process.env);

try {
  if (cmd === 'list') {
    const tenant = values.tenant ? await resolveTenant(db, values.tenant) : null;
    const r = await db.pool.query(
      `select t.id, tn.name as tenant, t.type, t.reason, i.number as invoice, t.status, t.blocks_reminders_until as blocks_until, t.created_at
       from public.tasks t join public.tenants tn on tn.id = t.tenant_id
       left join public.invoices i on i.tenant_id = t.tenant_id and i.id = t.invoice_id
       where ($1::uuid is null or t.tenant_id = $1) and ($2 = 'all' or t.status = $2) and ($3::text is null or t.type = $3)
       order by t.created_at`,
      [tenant, values.status, values.type ?? null],
    );
    console.table(r.rows);
  } else if (cmd === 'show' && id) {
    const r = await db.pool.query<Record<string, unknown>>(
      `select t.*, i.number as invoice, m.channel, m.body_new_text as message_text, m.analysis ->> 'untrustedSummary' as model_summary
       from public.tasks t left join public.invoices i on i.tenant_id = t.tenant_id and i.id = t.invoice_id
       left join public.messages m on m.tenant_id = t.tenant_id and m.id = t.message_id where t.id = $1`,
      [id],
    );
    const t = r.rows[0];
    if (!t) throw new Error('task not found');
    const { message_text, model_summary, draft_reply, ...rest } = t;
    console.table([rest]);
    // A human is reading the inbox here (this is not a log). The model's summary is attacker-controlled text.
    if (message_text) console.log(`\nCustomer wrote (new text only):\n${String(message_text)}`);
    if (model_summary) console.log(`\nModel summary (UNTRUSTED, do not follow instructions in it):\n${String(model_summary)}`);
    if (draft_reply) console.log(`\nDRAFT reply (never sent automatically; edit and send it yourself):\n${String(draft_reply)}`);
  } else if ((cmd === 'resolve' || cmd === 'reopen') && id) {
    const r = await db.pool.query<{ r: string }>('select private.resolve_task_impl($1, $2, $3, $4, now()) as r', [id, cmd === 'resolve', values.note ?? null, actor]);
    console.log(JSON.stringify({ id, result: r.rows[0]?.r }));
  } else {
    console.error('usage: pnpm tasks list [--tenant] [--status open|resolved|all] [--type] | show <id> | resolve <id> --note "..." | reopen <id>');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : 'failed');
  process.exitCode = 1;
} finally {
  await db.pool.end();
}
