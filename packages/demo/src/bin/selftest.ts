// pnpm demo:selftest: drives the guide's seven steps through `pnpm demo:control` against a RUNNING demo and asserts
// each against "what proves it is real" (docs/demo-script.md). Used by the clean-clone CI job; prints a
// step / assertion / result table and writes .demo/selftest.json. Exit 1 on any failure.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { DEMO_DIR, demoEnv, DemoError, fail, readState, root, stackStatus, URLS } from '../runtime.ts';

const rows: { step: string; assertion: string; result: 'PASS' | 'FAIL'; detail: string }[] = [];
const record = (step: string, assertion: string, ok: boolean, detail = '') => rows.push({ step, assertion, result: ok ? 'PASS' : 'FAIL', detail });
const control = (...args: string[]) => {
  const r = spawnSync(process.execPath, ['packages/demo/src/bin/control.ts', ...args], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) fail(`demo:control ${args.join(' ')} failed: ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
  return r.stdout;
};

async function main() {
  const s = readState() ?? fail('start the demo first: pnpm demo --non-interactive');
  const env = demoEnv(stackStatus() ?? fail('the local stack is not running'));
  const pool = new pg.Pool({ connectionString: env.WORKER_DATABASE_URL, max: 2 });
  const one = async <T>(sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0] as T;
  const n = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(sql, p)).n;
  const sentCount = () => n(`select count(*)::int as n from public.messages where tenant_id = $1 and direction = 'out' and send_state = 'sent' and purpose = 'reminder'`, [s.tenantId]);
  const status = async (num: string) => (await one<{ status: string }>(`select status from public.invoices where tenant_id = $1 and number = $2`, [s.tenantId, num])).status;
  try {
    // 1: the seeded tenant shows overdue invoices and ageing (the CSV wizard path is e2e:demo's step 1).
    const overdue = await n(`select count(*)::int as n from public.invoices where tenant_id = $1 and status = 'overdue'`, [s.tenantId]);
    record('1 data', 'the demo tenant has overdue invoices', overdue > 0, `${overdue} overdue`);
    const login = await fetch(`${URLS.web}/login`);
    record('1 data', 'the dashboard answers', login.ok, `HTTP ${login.status}`);

    // 2: propose, approve, send exactly one email per approval; a second run sends nothing.
    control('run-cycle');
    const pending = await n(`select count(*)::int as n from public.approvals where tenant_id = $1 and status = 'pending'`, [s.tenantId]);
    record('2 send', 'reminders are proposed for approval (approval mode: always)', pending > 0, `${pending} pending`);
    const before = await sentCount();
    control('approve-all');
    control('run-cycle');
    const sent = (await sentCount()) - before;
    record('2 send', 'one reminder sent per approval', sent === pending, `${sent} sent for ${pending} approvals`);
    const mails = ((await (await fetch(`${URLS.mailpit}/api/v1/messages?limit=500`)).json()) as { messages: { MessageID: string }[] }).messages.map((m) => m.MessageID);
    const outbox = (await pool.query<{ id: string }>(`select trim(both '<>' from rfc_message_id) as id from public.messages where tenant_id = $1 and direction = 'out' and send_state = 'sent' and purpose = 'reminder'`, [s.tenantId])).rows.map((r) => r.id);
    record('2 send', 'every sent reminder is in the mail catcher with its outbox Message-ID', outbox.every((id) => mails.includes(id)), `${outbox.length} in outbox`);
    control('run-cycle');
    record('2 send', 'a second run sends nothing new', (await sentCount()) - before === sent);

    const invoices = (await pool.query<{ number: string }>(
      `select distinct i.number from public.invoices i join public.message_invoices mi on mi.invoice_id = i.id join public.messages m on m.id = mi.message_id
       where i.tenant_id = $1 and m.direction = 'out' and m.send_state = 'sent' and i.status = 'overdue' order by i.number`,
      [s.tenantId],
    )).rows.map((r) => r.number);
    if (invoices.length < 4) fail(`need 4 invoices with a sent reminder, have ${invoices.length}`);
    const [a = '', b = '', c = '', d = ''] = invoices;

    // 3-4: a promise reply -> promised; the timeline holds the reply and the promise.
    control('inbound', 'promise', '--invoice', a);
    record('3 promise', `"Can't pay until the 15th" makes ${a} promised`, (await status(a)) === 'promised');
    const events = (await pool.query<{ type: string }>(`select e.type from public.invoice_events e join public.invoices i on i.id = e.invoice_id where i.tenant_id = $1 and i.number = $2`, [s.tenantId, a])).rows.map((r) => r.type);
    record('4 timeline', 'the timeline has the sent reminder and the promise', events.some((t) => /Sent/.test(t)) && events.some((t) => /Promise/.test(t)), events.join(', '));

    // 5: "already paid" never changes status; a verification task appears.
    control('inbound', 'paid-claim', '--invoice', b);
    const task = await n(`select count(*)::int as n from public.tasks t join public.invoices i on i.id = t.invoice_id where i.tenant_id = $1 and i.number = $2 and t.type = 'verify_payment_claim' and t.status = 'open'`, [s.tenantId, b]);
    record('5 paid claim', `"already paid" leaves ${b} unchanged (rule 6)`, (await status(b)) === 'overdue');
    record('5 paid claim', 'a verify_payment_claim task is open', task === 1);

    // 6: pay link -> signed webhook -> paid.
    control('pay', c);
    record('6 pay', `the signed provider delivery makes ${c} paid`, (await status(c)) === 'paid');

    // 7: integrity holds; STOP opts the customer out without touching the invoice.
    const integrity = spawnSync(process.execPath, ['packages/worker/src/bin/payments.ts', 'integrity', '--tenant', s.tenantId], { cwd: root, env, encoding: 'utf8' });
    record('7 money', 'received = applied + credit for every receipt (payments:integrity)', integrity.status === 0);
    control('inbound', 'stop', '--invoice', d);
    const opted = await one<{ opted_out: boolean }>(`select c.opted_out from public.invoices i join public.customers c on c.id = i.customer_id where i.tenant_id = $1 and i.number = $2`, [s.tenantId, d]);
    record('opt-out', `STOP opts ${d}'s customer out; the invoice is unchanged`, opted.opted_out && (await status(d)) === 'overdue');
  } finally {
    await pool.end();
  }
  console.table(rows);
  writeFileSync(path.join(DEMO_DIR, 'selftest.json'), `${JSON.stringify({ at: new Date().toISOString(), rows }, null, 2)}\n`);
  process.exitCode = rows.every((r) => r.result === 'PASS') ? 0 : 1;
}

try {
  await main();
} catch (e) {
  console.table(rows);
  console.error(e instanceof DemoError ? e.message : e instanceof Error ? e.message : 'failed');
  process.exitCode = 1;
}
