// pnpm demo:replies [--live] — prompt 4's walkthrough on the LOCAL stack (run `pnpm db:reset` first):
//   1. demo:send, so real reminders (with our Message-IDs) exist;
//   2. six scripted customer replies through the REAL entry points: WhatsApp as signed POSTs to the real
//      webhook endpoint, email through the IMAP poller's store step (no IMAP server in the demo);
//   3. the REAL processor with a deterministic scripted classifier (or the configured model with --live);
//   4. a table of what happened, then the worker: no reminder to the promised, disputed, claimed or
//      opted-out customers. The scripted classifier proves the PIPELINE, not AI accuracy.
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pgImapStore } from '@dueloop/adapters-email';
import { processInboundBatch } from '@dueloop/inbound';
import { createWebhookServer, DEFAULT_WEBHOOK_CONFIG, pgWebhookStore, signMeta } from '@dueloop/webhooks';
import { parseArgs } from 'node:util';
import { KeywordBaselineClassifier } from '../../classifier/eval/keyword-baseline.ts';
import { buildInboundDeps, classifierFrom } from '../src/inbound-runtime.ts';
import { openDb } from '../src/runtime.ts';
import { demoNow, DEMO_ZONE } from './demo-clock.ts';

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false } } });
const here = path.dirname(fileURLToPath(import.meta.url));
const TENANT = '5eed0000-0000-4000-8000-00000000000a';
const APP_SECRET = 'demo-app-secret-not-a-real-one';
const PHONE_NUMBER_ID = '100000000000001';

class DemoFailure extends Error {}
const fail = (msg: string): never => {
  throw new DemoFailure(msg);
};

const at = demoNow();
const nowIso = at.toUTC().toISO() ?? '';
const now = new Date(nowIso);
const env: NodeJS.ProcessEnv = { ...process.env, DEMO_NOW: nowIso, SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325', SMTP_SECURE: 'false' };
delete env.WORKER_DATABASE_URL;

const node = (script: string, args: string[] = []) => {
  const r = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) fail(`${path.basename(script)} exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(-500)}`);
  return r.stdout;
};

const db = openDb(env);
const q = async <R extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query<R>(sql, p)).rows;
const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
const rfc = at.toFormat('ccc, dd LLL yyyy HH:mm:ss ZZZ');

try {
  console.log(`Demo clock: ${at.toFormat('ccc d LLL yyyy HH:mm')} ${DEMO_ZONE}`);
  console.log('\n1) demo:send: reminders go out (approve-all, Mailpit) so replies can thread to our Message-IDs.');
  const sendOut = node(path.join(here, 'demo-send.ts'));
  console.log(`   ${sendOut.trim().split('\n').at(-1)}`);

  // Our reminders' Message-IDs, by invoice number.
  const sent = await q<{ number: string; rfc: string }>(
    `select i.number, m.rfc_message_id as rfc from public.messages m join public.message_invoices mi on mi.tenant_id = m.tenant_id and mi.message_id = m.id
     join public.invoices i on i.tenant_id = mi.tenant_id and i.id = mi.invoice_id where m.tenant_id = $1 and m.direction = 'out' and m.send_state = 'sent'`,
    [TENANT],
  );
  const rfcOf = (n: string) => sent.find((s) => s.number === n)?.rfc ?? fail(`no reminder was sent for ${n}`);
  const emailAccount = (await q<{ id: string }>(`select id from public.channel_accounts where tenant_id = $1 and channel = 'email'`, [TENANT]))[0]?.id ?? fail('no email account');
  const wa = await q<{ id: string }>(
    `insert into public.channel_accounts (tenant_id, channel, config, external_account_id) values ($1, 'whatsapp', $2, $3)
     on conflict (tenant_id, channel) do update set external_account_id = excluded.external_account_id returning id`,
    [TENANT, JSON.stringify({ phone_number_id: PHONE_NUMBER_ID }), PHONE_NUMBER_ID],
  );
  if (!wa[0]) fail('could not set up the demo WhatsApp account');

  const email = (o: { from: string; id: string; inReplyTo?: string; subject?: string; body: string; extra?: string }) =>
    crlf(
      [`From: ${o.from}`, 'To: billing@demo-agency.test', `Subject: ${o.subject ?? 'Re: Friendly reminder'}`, `Message-ID: ${o.id}`, ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`] : []), `Date: ${rfc}`, ...(o.extra ? [o.extra] : []), 'Content-Type: text/plain; charset=utf-8', '', o.body, ''].join('\n'),
    );
  const dsn = (bounced: string) =>
    crlf(
      [
        'From: Mail Delivery System <MAILER-DAEMON@mx.mueller.example>',
        'To: billing@demo-agency.test',
        'Subject: Undelivered Mail Returned to Sender',
        `Message-ID: <dsn-${Date.now()}@mx.mueller.example>`,
        `Date: ${rfc}`,
        'MIME-Version: 1.0',
        'Content-Type: multipart/report; report-type=delivery-status; boundary="RR"',
        '',
        '--RR',
        'Content-Type: message/delivery-status',
        '',
        'Reporting-MTA: dns; mx.mueller.example',
        '',
        'Action: failed',
        'Status: 5.1.1',
        '--RR',
        'Content-Type: text/rfc822-headers',
        '',
        `Message-ID: ${bounced}`,
        '--RR--',
        '',
      ].join('\n'),
    );

  type Script = { label: string; invoice: string; channel: 'email' | 'whatsapp'; send: () => Promise<void> };
  const imap = pgImapStore(db.pool);
  const storeEmail = async (raw: string, id: string) => void (await imap.store(emailAccount, id, null, raw, now));

  // The real webhook endpoint, in-process, on a random port.
  const server = createWebhookServer({ store: pgWebhookStore(db.pool), config: { ...DEFAULT_WEBHOOK_CONFIG, appSecret: APP_SECRET, verifyToken: 'demo' }, now: () => now, log: () => undefined });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const whatsapp = async (fromE164: string, wamid: string, text: string) => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'DEMO_WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: PHONE_NUMBER_ID }, messages: [{ from: fromE164.replace('+', ''), id: wamid, timestamp: String(Math.floor(now.getTime() / 1000)), type: 'text', text: { body: text } }] } }] }],
    });
    const r = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signMeta(body, APP_SECRET) } });
    if (r.status !== 200) fail(`webhook answered ${r.status}`);
  };

  const scripts: Script[] = [
    { label: '"Can\'t pay until the 15th, sorry."', invoice: 'DA-0001', channel: 'email', send: () => storeEmail(email({ from: 'Acme Ltd <accounts@acme.example>', id: '<r1@acme.example>', inReplyTo: rfcOf('DA-0001'), body: "Can't pay until the 15th, sorry." }), '<r1@acme.example>') },
    { label: '"Will pay soon, promise."', invoice: 'DA-0004', channel: 'email', send: () => storeEmail(email({ from: 'Müller GmbH <buchhaltung@mueller.example>', id: '<r2@mueller.example>', inReplyTo: rfcOf('DA-0004'), body: 'Will pay soon, promise.' }), '<r2@mueller.example>') },
    { label: '"Already paid, sent the transfer yesterday."', invoice: 'DA-0006', channel: 'whatsapp', send: () => whatsapp('+447700900106', 'wamid.demo3', 'Already paid, sent the transfer yesterday.') },
    { label: '"We never ordered this, the invoice is wrong."', invoice: 'DA-0009', channel: 'email', send: () => storeEmail(email({ from: 'Acme Ltd <accounts@acme.example>', id: '<r4@acme.example>', inReplyTo: rfcOf('DA-0009'), body: 'We never ordered this, the invoice is wrong.' }), '<r4@acme.example>') },
    { label: '"STOP"', invoice: 'DA-0008', channel: 'whatsapp', send: () => whatsapp('+971501234567', 'wamid.demo5', 'STOP') },
    { label: 'bounce (DSN 5.1.1)', invoice: 'DA-0012', channel: 'email', send: () => storeEmail(dsn(rfcOf('DA-0012')), `<dsn-${'DA-0012'}>`) },
  ];

  const invoiceState = async (n: string) => (await q<{ id: string; status: string; next: Date }>('select id, status, next_action_at as next from public.invoices where tenant_id = $1 and number = $2', [TENANT, n]))[0] ?? fail(`no ${n}`);
  const before = new Map<string, string>();
  for (const s of scripts) before.set(s.invoice, (await invoiceState(s.invoice)).status);

  console.log('\n2) Six customer replies arrive (WhatsApp: signed POSTs to the real webhook; email: the IMAP store step).');
  for (const s of scripts) await s.send();
  await new Promise((r) => server.close(r));

  // Scripted classifier: the keyword baseline's reading of each message, stated with high confidence (it is a script).
  const keyword = new KeywordBaselineClassifier('reply-v1');
  const scripted = { promptVersion: 'demo-script', classify: async (input: Parameters<typeof keyword.classify>[0]) => {
    const r = await keyword.classify(input);
    return r.ok ? { ...r, modelId: 'demo-script', raw: { ...(r.raw as Record<string, unknown>), confidence: 0.95 } } : r;
  } };
  const classifier = values.live ? classifierFrom({ ...env, CLASSIFIER: 'anthropic' }, () => performance.now()) : scripted;
  console.log(`\n3) The real inbound processor runs with ${values.live ? `the configured model (${env.CLASSIFIER_MODEL ?? 'unset'})` : 'a deterministic SCRIPTED classifier'}.`);
  const deps = buildInboundDeps(env, db, { now: () => now }, classifier);
  const r = await processInboundBatch(deps, { limit: 50, filter: { tenant_id: TENANT } });
  console.log(`   processor outcomes: ${JSON.stringify(r.outcomes)}`);

  const rows = [];
  for (const s of scripts) {
    const inv = await invoiceState(s.invoice);
    const msg = (
      await q<{ analysis: Record<string, unknown> | null; prefilter: string | null }>(
        `select m.analysis, m.prefilter from public.messages m where m.tenant_id = $1 and m.direction = 'in' and m.received_at is not null
         and (exists (select 1 from public.message_invoices mi where mi.message_id = m.id and mi.invoice_id = $2) or (m.prefilter = 'bounce' and $3))
         order by m.created_at desc limit 1`,
        [TENANT, inv.id, s.invoice === 'DA-0012'],
      )
    )[0];
    const tasks = await q<{ type: string; reason: string | null; until: Date | null }>(
      `select type, reason, blocks_reminders_until as until from public.tasks where tenant_id = $1 and (invoice_id = $2 or (type = 'invalid_contact' and $3)) order by created_at`,
      [TENANT, inv.id, s.invoice === 'DA-0012'],
    );
    const optedOut = s.invoice === 'DA-0008' ? (await q<{ o: boolean }>(`select c.opted_out as o from public.customers c join public.invoices i on i.customer_id = c.id where i.id = $1`, [inv.id]))[0]?.o : false;
    const a = msg?.analysis ?? {};
    const effect = [
      ...tasks.map((t) => `task ${t.type}${t.reason ? ` (${t.reason})` : ''}${t.until ? `, reminders paused to ${t.until.toISOString().slice(0, 10)}` : ''}`),
      ...(optedOut ? ['customer opted out on every channel'] : []),
      ...(before.get(s.invoice) !== inv.status ? [`${before.get(s.invoice)} -> ${inv.status}`] : []),
    ].join('; ');
    rows.push({
      message: s.label,
      channel: s.channel,
      invoice: s.invoice,
      intent: msg?.prefilter && msg.prefilter !== 'none' ? `(pre-filter: ${msg.prefilter})` : String(a.intent ?? a.review ?? '-'),
      proposal: a.promisedDate ? `pay on ${String(a.promisedDate)}` : a.dateIsVague ? 'vague date' : '-',
      effect: effect || 'none',
      before: before.get(s.invoice),
      after: inv.status,
      next_action: Number.isFinite(inv.next.getTime()) ? inv.next.toISOString().slice(0, 16) : 'parked',
    });
  }
  console.table(rows);

  console.log('\n4) Next day: three rounds of worker -> approve all. No reminder activity may reach the promised, disputed, claimed or opted-out invoices.');
  const tomorrow = at.plus({ days: 1 }).set({ hour: 10, minute: 0 }).toUTC().toISO() ?? '';
  const workerBin = path.join(here, '../src/bin/worker.ts');
  for (let round = 0; round < 3; round++) {
    node(workerBin, ['--once', '--tenant', 'Demo Agency', '--now', tomorrow]);
    node(path.join(here, '../src/bin/approvals.ts'), ['approve', '--all-pending', '--tenant', 'Demo Agency']);
  }
  // Activity from tomorrow on: reminders proposed for approval, sent, or skipped (e.g. no phone for a WhatsApp step).
  const after = await q<{ number: string; approvals: number; sent: number; skipped: number }>(
    `select i.number,
            (select count(*)::int from public.approvals a where a.tenant_id = i.tenant_id and a.invoice_id = i.id and a.requested_at >= $2) as approvals,
            (select count(*)::int from public.message_invoices mi join public.messages m on m.id = mi.message_id
             where mi.tenant_id = i.tenant_id and mi.invoice_id = i.id and m.direction = 'out' and m.send_state = 'sent' and m.sent_at >= $2) as sent,
            (select count(*)::int from public.message_invoices mi join public.messages m on m.id = mi.message_id
             where mi.tenant_id = i.tenant_id and mi.invoice_id = i.id and m.direction = 'out' and m.send_state = 'skipped' and m.pending_since >= $2) as skipped
     from public.invoices i where i.tenant_id = $1 and i.number in ('DA-0001', 'DA-0003', 'DA-0004', 'DA-0006', 'DA-0008', 'DA-0009', 'DA-0011', 'DA-0012') order by 1`,
    [TENANT, new Date(tomorrow)],
  );
  const why: Record<string, string> = { 'DA-0001': 'promised', 'DA-0009': 'disputed', 'DA-0006': '"already paid" (paused)', 'DA-0008': 'opted out' };
  console.table(after.map((x) => ({ invoice: x.number, reason: why[x.number] ?? '(no blocking reply)', approvals_requested: x.approvals, reminders_sent: x.sent, steps_skipped: x.skipped })));
  const busy = (x: (typeof after)[number]) => x.approvals + x.sent + x.skipped > 0;
  const leaked = after.filter((x) => why[x.number] && busy(x));
  if (leaked.length) fail(`the worker acted on ${leaked.map((x) => x.number).join(', ')}`);
  const others = after.filter((x) => !why[x.number]);
  if (!others.some(busy)) fail('the worker did nothing for any invoice: the comparison would prove nothing');
  console.log(
    `\nDEMO OK: replies changed state only through planReplyOutcome + the state machine. The 4 protected invoices got no reminder activity; ${others.filter(busy).length} of ${others.length} other invoices did (${others.reduce((s, x) => s + x.sent, 0)} reminders sent).`,
  );
  console.log('NOTE: the scripted classifier proves the pipeline, not AI accuracy. Use --live with CLASSIFIER_MODEL to see a real model.');
} catch (e) {
  if (!(e instanceof DemoFailure)) throw e;
  console.error(`\nDEMO FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.pool.end();
}
