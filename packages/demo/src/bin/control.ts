// pnpm demo:control <command>  (only while `pnpm demo` runs; local stack only)
//   run-cycle                       enqueue + one worker pass with the injected clock at the next send window
//   approve-all                     approve every pending reminder (the dashboard's bulk approve, as a command)
//   inbound promise|vague|paid-claim|dispute|stop [--invoice <number>]
//                                   a customer reply to our last reminder, stored as the IMAP poller stores it; the
//                                   running demo processor classifies it (scripted) and applies the plan
//   pay <invoice number>            the pay link from a reminder -> "Pay now" on the REAL pay page -> the 303 to the
//                                   provider -> the signed FakeGateway link.paid delivery to the RUNNING webhooks
//                                   service (what a hosted checkout does after the customer pays) -> worker pass
//   status                          invoice statuses, approvals, tasks, emails, heartbeats
//   reset-state                     same as `pnpm demo:reset`
// Same pipelines as production; only the clock source (--now) and the entry point differ.
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pgImapStore } from '@dueloop/adapters-email';
import { FakeGateway } from '@dueloop/adapters-payments';
import { issueLinks } from '@dueloop/links';
import pg from 'pg';
import { demoNow } from '../../../worker/scripts/demo-clock.ts';
import { alive, demoEnv, DemoError, fail, readState, root, stackStatus, TENANT, until, URLS } from '../runtime.ts';

const REPLIES: Record<string, string> = {
  promise: "Can't pay until the 15th, sorry.",
  vague: 'Will sort it out soon.',
  'paid-claim': 'We already paid this last week.',
  dispute: 'This invoice is wrong, we never received the goods.',
  stop: 'STOP',
};

const state = readState();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function main() {
  if (cmd === 'reset-state') {
    const r = spawnSync(process.execPath, ['packages/demo/src/bin/demo.ts', 'reset'], { cwd: root, stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
    return;
  }
  // DEMO_MODE: only while the demo runs (its state file), only against the local stack (safety gate).
  if (!state || state.mode !== 'demo' || !Object.values(state.pids).some(alive)) fail('the demo is not running: start it with `pnpm demo`');
  const env = demoEnv(stackStatus() ?? fail('the local Supabase stack is not running'));
  const s = state as NonNullable<typeof state>;
  const pool = new pg.Pool({ connectionString: env.WORKER_DATABASE_URL, max: 2 });
  const q = async <R extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await pool.query<R>(sql, p)).rows;
  const node = (args: string[]) => {
    const r = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8' });
    if (r.status !== 0) fail(`${args[0]} failed: ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
    return r.stdout;
  };
  const passTotals = (out: string) => out.split('\n').reverse().find((l) => l.includes('"pass_done"')) ?? out.trim().split('\n').pop() ?? '';
  const invoice = async (number: string | undefined) => {
    const rows = number
      ? await q<{ id: string; number: string; customer_id: string; status: string }>(`select id, number, customer_id, status from public.invoices where tenant_id = $1 and number = $2`, [s.tenantId, number])
      : await q<{ id: string; number: string; customer_id: string; status: string }>(
          `select i.id, i.number, i.customer_id, i.status from public.invoices i join public.message_invoices mi on mi.invoice_id = i.id join public.messages m on m.id = mi.message_id
           where i.tenant_id = $1 and m.direction = 'out' and m.send_state = 'sent' and i.status in ('open', 'overdue') order by m.sent_at desc limit 1`,
          [s.tenantId],
        );
    return rows[0] ?? fail(number ? `no invoice ${number} in ${TENANT}` : 'no invoice has a sent reminder yet: run `run-cycle`, approve, `run-cycle` again');
  };
  try {
    if (cmd === 'run-cycle') {
      const now = demoNow().toISO() ?? '';
      console.log(`worker pass with the injected clock at ${now} (the next send window in the tenant's time zone)`);
      console.log(passTotals(node(['packages/worker/src/bin/worker.ts', '--once', '--now', now])));
    } else if (cmd === 'approve-all') {
      process.stdout.write(node(['packages/worker/src/bin/approvals.ts', 'approve', '--all-pending', '--tenant', TENANT]));
    } else if (cmd === 'inbound') {
      const kind = rest[0] ?? '';
      const body = REPLIES[kind] ?? fail(`inbound needs one of: ${Object.keys(REPLIES).join(', ')}`);
      const inv = await invoice(opt('--invoice'));
      const [m] = await q<{ rfc: string; email: string | null }>(
        `select m.rfc_message_id as rfc, c.email from public.messages m join public.message_invoices mi on mi.message_id = m.id join public.customers c on c.id = m.customer_id
         where mi.invoice_id = $1 and m.direction = 'out' and m.send_state = 'sent' order by m.sent_at desc limit 1`,
        [inv.id],
      );
      if (!m?.email) fail(`invoice ${inv.number} has no sent email reminder to reply to`);
      const [acct] = await q<{ id: string }>(`select id from public.channel_accounts where tenant_id = $1 and channel = 'email'`, [s.tenantId]);
      const id = `<reply-${randomUUID()}@customer.example.test>`;
      const at = new Date();
      const raw = [`From: ${m?.email}`, 'To: billing@demo-agency.test', 'Subject: Re: invoice reminder', `Message-ID: ${id}`, `In-Reply-To: ${m?.rfc}`, `Date: ${at.toUTCString()}`, 'Content-Type: text/plain; charset=utf-8', '', body, ''].join('\r\n');
      await pgImapStore(pool).store(acct?.id ?? fail('no email account'), id, null, raw, at);
      console.log(`stored a "${kind}" reply to ${inv.number}; waiting for the demo processor...`);
      await until('the reply to be processed', 60_000, async () => (await q(`select 1 from public.inbound_events where status = 'pending' and tenant_id = $1`, [s.tenantId])).length === 0);
      const [after] = await q<{ status: string; next_action_at: string | null; opted_out: boolean }>(`select i.status, i.next_action_at, c.opted_out from public.invoices i join public.customers c on c.id = i.customer_id where i.id = $1`, [inv.id]);
      const tasks = await q<{ type: string }>(`select type from public.tasks where invoice_id = $1 and status = 'open'`, [inv.id]);
      console.table([{ invoice: inv.number, before: inv.status, after: after?.status, customer_opted_out: after?.opted_out, next_check_at: after?.next_action_at, open_tasks: tasks.map((x) => x.type).join(', ') || '-' }]);
    } else if (cmd === 'pay') {
      const inv = await invoice(rest[0] ?? fail('pay needs an invoice number, e.g. `pay DA-0001`'));
      const links = await issueLinks(pool, { tenantId: s.tenantId, invoiceId: inv.id, customerId: inv.customer_id, now: new Date(), baseUrl: URLS.web });
      const page = links.payUrl ?? fail('no pay link was issued (is the invoice still payable?)');
      const act = await fetch(`${page}/act`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin', Origin: URLS.web }, body: 'action=pay' });
      const location = act.headers.get('location') ?? fail(`"Pay now" answered ${act.status} without a redirect to the provider`);
      const link = new URL(location).pathname.split('/').pop() ?? '';
      const [req] = await q<{ amount: string; currency: string }>(`select amount::text as amount, currency from public.payment_requests where provider_object_id = $1`, [link]);
      if (!req) fail('no payment request was created for that link');
      const gw = new FakeGateway({ secret: s.payment.secret, clock: { now: () => new Date() } });
      gw.forge({ type: 'link.paid', data: { link, payment: `fpay_demo_${randomUUID().slice(0, 8)}`, amount: Number(req?.amount), currency: req?.currency ?? 'GBP' } });
      const d = gw.drain()[0] ?? fail('no delivery');
      const hook = await fetch(`${URLS.webhooks}/webhooks/payments/${s.payment.token}`, { method: 'POST', body: d.rawBody, headers: d.headers });
      console.log(`"Pay now" -> provider link ${link}; signed link.paid delivered to the webhooks service: HTTP ${hook.status}`);
      console.log(passTotals(node(['packages/worker/src/bin/payments.ts', 'process', '--once'])));
      const [after] = await q<{ status: string }>(`select status from public.invoices where id = $1`, [inv.id]);
      console.table([{ invoice: inv.number, before: inv.status, after: after?.status, receipt_email: 'see the mail catcher after the next worker pass' }]);
    } else if (cmd === 'status') {
      console.table(await q(`select status, count(*)::int as invoices from public.invoices where tenant_id = $1 group by 1 order by 1`, [s.tenantId]));
      console.table(await q(`select 'approvals pending' as what, count(*)::int as n from public.approvals where tenant_id = $1 and status = 'pending' union all select 'open tasks', count(*)::int from public.tasks where tenant_id = $1 and status = 'open' union all select 'emails sent', count(*)::int from public.messages where tenant_id = $1 and direction = 'out' and send_state = 'sent'`, [s.tenantId]));
      console.table(await q(`select service, round(extract(epoch from now() - last_seen_at))::int as seconds_since_heartbeat from private.service_heartbeats order by 1`));
    } else fail('usage: demo:control run-cycle | approve-all | inbound <kind> [--invoice N] | pay <invoice> | status | reset-state');
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (e) {
  console.error(e instanceof DemoError ? e.message : e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, '[db-url]') : 'failed');
  process.exitCode = 1;
}
