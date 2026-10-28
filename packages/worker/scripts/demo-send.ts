// pnpm demo:send — the Prompt 3 walkthrough on the LOCAL stack, using the real CLIs and the real SMTP adapter:
//   1. worker pass       -> overdue invoices get reminders proposed; Demo Agency is approval_mode=always
//   2. approvals list    -> what a human would review
//   3. approvals approve --all-pending --tenant "Demo Agency"
//   4. worker pass       -> ONE email per approved reminder lands in Mailpit (http://127.0.0.1:54324)
//   5. worker pass again -> 0 new emails (idempotency keys + outbox)
// Prints ids, numbers and counts only; never bodies or contact details (rule 20).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import pg from 'pg';
import { localEnv } from '../../db/scripts/local-env.ts';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const TENANT = 'Demo Agency';
const ZONE = 'Europe/London';
const bin = (name: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../src/bin/${name}.ts`);
const env: NodeJS.ProcessEnv = { ...process.env, SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325', SMTP_SECURE: 'false' };
delete env.WORKER_DATABASE_URL; // the demo is local-only, whatever the shell has set

function fail(msg: string): never {
  console.error(`\nDEMO FAILED: ${msg}`);
  process.exit(1);
}

function run(script: string, args: string[]): string {
  console.log(`\n$ pnpm ${script} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
  const r = spawnSync(process.execPath, [bin(script), ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) fail(`${script} exited ${r.status}: ${r.stderr.trim()}`);
  return r.stdout;
}

/** The worker logs JSON lines; show the pass summary only. */
function passSummary(stdout: string): Record<string, number> {
  const line = stdout.split('\n').reverse().find((l) => l.includes('"pass_done"'));
  const totals = line ? (JSON.parse(line) as { totals: Record<string, number> }).totals : {};
  console.log(`  outcomes: ${JSON.stringify(totals)}`);
  return totals;
}

async function mailpit(): Promise<{ MessageID: string; Subject: string }[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=500`).catch(() => null);
  if (!res?.ok) fail(`Mailpit is not reachable at ${MAILPIT}. Is [local_smtp] enabled and the stack restarted?`);
  return ((await res.json()) as { messages: { MessageID: string; Subject: string }[] }).messages;
}

// A send window for Demo Agency (09:00-20:00 London): now if inside it, else 10:00 on the next weekday.
const real = DateTime.utc().setZone(ZONE);
let at = real;
if (real.hour < 9 || real.hour >= 19 || real.weekday > 5) {
  at = real.plus({ days: real.hour >= 19 ? 1 : 0 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (at.weekday > 5) at = at.plus({ days: 1 });
}
const nowIso = at.toUTC().toISO() ?? fail('bad clock');
console.log(`Demo clock: ${at.toFormat("ccc d LLL yyyy HH:mm")} ${ZONE} (--now ${nowIso})`);

const pool = new pg.Pool({ connectionString: localEnv().dbUrl, max: 2 });
const tenantId = (await pool.query<{ id: string }>('select id from public.tenants where name = $1', [TENANT])).rows[0]?.id ?? fail('run `pnpm db:reset` first (no Demo Agency)');
const already = (await pool.query<{ n: number }>(`select count(*)::int as n from public.messages where tenant_id = $1 and direction = 'out' and send_state = 'sent'`, [tenantId])).rows[0]?.n ?? 0;
if (already > 0) fail(`Demo Agency already has ${already} sent message(s). Run \`pnpm db:reset\` for a clean walkthrough.`);
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);

console.log('\n1) Worker pass: due invoices are decided; every proposed send needs approval.');
passSummary(run('worker', ['--once', '--tenant', TENANT, '--now', nowIso]));

console.log('\n2) Pending approvals (what the owner would review):');
process.stdout.write(run('approvals', ['list', '--tenant', TENANT]));
const pending = (await pool.query<{ n: number }>(`select count(*)::int as n from public.approvals where tenant_id = $1 and status = 'pending'`, [tenantId])).rows[0]?.n ?? 0;
if (pending === 0) fail('no approvals were requested');

console.log('\n3) Approve them all:');
process.stdout.write(run('approvals', ['approve', '--all-pending', '--tenant', TENANT]));

console.log('\n4) Worker pass: approved reminders are re-validated (decide() + every gate) and sent.');
passSummary(run('worker', ['--once', '--tenant', TENANT, '--now', nowIso]));
const afterFirst = await mailpit();

const sent = await pool.query<{ number: string; step_id: string; rfc_message_id: string }>(
  `select i.number, m.step_id, m.rfc_message_id from public.messages m
   join public.message_invoices mi on mi.tenant_id = m.tenant_id and mi.message_id = m.id
   join public.invoices i on i.tenant_id = mi.tenant_id and i.id = mi.invoice_id
   where m.tenant_id = $1 and m.channel = 'email' and m.direction = 'out' and m.send_state = 'sent' order by i.number`,
  [tenantId],
);
const approvedEmail = await pool.query<{ number: string; step_id: string; outcome: string }>(
  `select i.number, a.step_id, coalesce(m.send_state, 'no message: ' || coalesce(i.parked_reason, 'not sent')) as outcome
   from public.approvals a join public.invoices i on i.tenant_id = a.tenant_id and i.id = a.invoice_id
   left join public.messages m on m.tenant_id = a.tenant_id and m.idempotency_key = a.idempotency_key
   where a.tenant_id = $1 and a.status = 'approved' and a.channel = 'email' order by i.number`,
  [tenantId],
);
console.log('\nApproved email reminders and what happened to each:');
console.table(approvedEmail.rows);

const ids = afterFirst.map((m) => `<${m.MessageID}>`).sort();
const expected = sent.rows.map((r) => r.rfc_message_id).sort();
console.log(`Mailpit: ${afterFirst.length} email(s); outbox: ${sent.rows.length} sent email(s).`);
if (afterFirst.length === 0) fail('no email reached Mailpit');
if (JSON.stringify(ids) !== JSON.stringify(expected)) fail('Mailpit Message-IDs do not match the outbox one-to-one');
if (new Set(ids).size !== ids.length) fail('a Message-ID arrived twice');
const sentApproved = approvedEmail.rows.filter((r) => r.outcome === 'sent').length;
if (sentApproved !== afterFirst.length) fail(`expected one email per sent approved reminder (${sentApproved}), got ${afterFirst.length}`);

console.log('\n5) Worker pass again: nothing new may be sent.');
passSummary(run('worker', ['--once', '--tenant', TENANT, '--now', nowIso]));
const afterSecond = await mailpit();
console.log(`Mailpit: ${afterSecond.length} email(s) (${afterSecond.length - afterFirst.length} new).`);
if (afterSecond.length !== afterFirst.length) fail('the second run sent again');

await pool.end();
console.log(`\nDEMO OK: ${afterFirst.length} approved reminder email(s), one each, Message-IDs match the outbox; second run: 0 new. Open ${MAILPIT} to read them.`);
