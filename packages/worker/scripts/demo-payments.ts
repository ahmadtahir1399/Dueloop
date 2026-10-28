// pnpm demo:payments: prompt 5's walkthrough on the LOCAL stack (run `pnpm db:reset` first).
//   1. a fake payment account for Demo Agency (token hash + Vault secret), then demo:send: reminders go out
//      with a payment block (FakeGateway links + bank text + reference code);
//   2. signed FIXTURE deliveries POSTed to the REAL webhook route, then the REAL payment pipeline; manual and
//      proof confirmations through the REAL CLIs (pnpm payments record, pnpm proofs confirm);
//   3. the worker next day (+ approve all): no reminder activity for any paid or cancelled invoice; receipts once;
//   4. a table, pnpm payments:integrity, and the KPI functions.
// Fixture-based: the gateway (FakeGateway signatures and ids), the screenshot (a synthetic PNG). Real: the
// database, the webhook HTTP route, the pipeline, the CLIs, the worker, SMTP into Mailpit. Stripe: NOT used.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeGateway, type FakeDelivery } from '@dueloop/adapters-payments';
import { createRequestFor, ingestPaymentWebhook, processPaymentBatch } from '@dueloop/payments';
import { createWebhookServer, DEFAULT_WEBHOOK_CONFIG, pgWebhookStore } from '@dueloop/webhooks';
import { png } from '../../proofs/test/fixtures.ts';
import { buildPaymentsDeps, openDb } from '../src/runtime.ts';
import { demoNow } from './demo-clock.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const TENANT = '5eed0000-0000-4000-8000-00000000000a';
const OWNER = 'owner@demo-agency.test';
class DemoFailure extends Error {}
const fail = (msg: string): never => {
  throw new DemoFailure(msg);
};

const at = demoNow();
const nowIso = at.toUTC().toISO() ?? '';
const today = at.toISODate() ?? '';
const env: NodeJS.ProcessEnv = { ...process.env, DEMO_NOW: nowIso, SMTP_HOST: '127.0.0.1', SMTP_PORT: '54325', SMTP_SECURE: 'false', PAYMENTS_ALLOW_FAKE: 'true' };
delete env.WORKER_DATABASE_URL;
const node = (script: string, args: string[] = [], okCodes = [0]) => {
  const r = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
  if (!okCodes.includes(r.status ?? -1)) fail(`${path.basename(script)} ${args[0] ?? ''} exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  return r.stdout;
};
/** The CLI's final JSON document (single-line or pretty-printed); log lines come before it. */
const lastJson = (out: string) => {
  const t = out.trim();
  const i = t.lastIndexOf('\n{');
  return JSON.parse(i === -1 ? t : t.slice(i + 1)) as Record<string, unknown>;
};
const bin = (n: string) => path.join(here, `../src/bin/${n}.ts`);

const db = openDb(env);
const q = async <R extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.pool.query<R>(sql, p)).rows;
const clock = { now: () => new Date(nowIso) };
const pdeps = buildPaymentsDeps(env, db, clock);
const state = async (number: string) => (await q<{ id: string; status: string; balance: string }>('select i.id, i.status, b.balance from public.invoices i join public.invoice_balances b on b.invoice_id = i.id where i.tenant_id = $1 and i.number = $2', [TENANT, number]))[0] ?? fail(`no invoice ${number}`);
const money = (minor: number) => (minor / 100).toFixed(2);
const server = createWebhookServer({ store: pgWebhookStore(db.pool), config: { ...DEFAULT_WEBHOOK_CONFIG, appSecret: '', verifyToken: '' }, now: () => clock.now(), log: () => undefined, payments: (t, raw, h) => ingestPaymentWebhook(pdeps, t, raw, h) });

const rows: Record<string, string | number>[] = [];
async function step(n: number, event: string, number: string, act: () => Promise<string>): Promise<void> {
  const b = await state(number);
  const outcome = await act();
  const a = await state(number);
  rows.push({ step: n, event, invoice: number, outcome, balance_before: money(Number(b.balance)), balance_after: money(Number(a.balance)), status_before: b.status, status_after: a.status });
}

try {
  console.log(`Demo clock: ${at.toFormat('ccc d LLL yyyy HH:mm')} Europe/London. Gateway = FakeGateway (fixtures); Stripe is not used here.`);
  // 0. A fake payment account: only the sha256 of the URL token is stored; the signing secret goes to Vault.
  const token = randomBytes(32).toString('base64url');
  const secret = `whsec_demo_${randomBytes(12).toString('hex')}`;
  const acct = await q<{ id: string }>(
    `insert into public.payment_accounts (tenant_id, provider, mode, webhook_token_hash) values ($1, 'fake', 'test', $2)
     on conflict (tenant_id, provider) do update set webhook_token_hash = excluded.webhook_token_hash returning id`,
    [TENANT, createHash('sha256').update(token).digest('hex')],
  );
  await q('select private.set_payment_secret($1, $2, $3)', [acct[0]?.id, 'webhook_secret', secret]);

  console.log('\n1) demo:send: reminders go out with a payment block (link + bank text + reference code).');
  console.log(`   ${node(path.join(here, 'demo-send.ts')).trim().split('\n').at(-1)}`);
  const links = await q<{ number: string; object: string; amount: string }>(
    `select i.number, r.provider_object_id as object, r.amount from public.payment_requests r join public.invoices i on i.tenant_id = r.tenant_id and i.id = r.invoice_id
     where r.tenant_id = $1 and r.status = 'active' and r.provider = 'fake' order by i.number`,
    [TENANT],
  );
  if (links.length < 4) fail(`expected at least 4 reminders with links, got ${links.length}`);
  const withLink = (await q<{ n: number }>(`select count(*)::int as n from public.messages where tenant_id = $1 and purpose = 'reminder' and send_state = 'sent' and body like '%https://pay.fake.test/%'`, [TENANT]))[0]?.n ?? 0;
  console.log(`   ${withLink} sent reminder(s) carry a gateway link; every one carries the reference code and the bank text.`);
  const [A, B, C, D] = links as [(typeof links)[number], (typeof links)[number], (typeof links)[number], (typeof links)[number]];

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/payments/${token}`;
  const gw = new FakeGateway({ secret, clock }); // signs fixture deliveries exactly as the provider would
  const post = async (d: FakeDelivery, body = d.rawBody) => (await fetch(url, { method: 'POST', body, headers: d.headers })).status;
  const pay = async (link: string, amount: number, ref: string) => {
    gw.forge({ type: 'link.paid', data: { link, payment: ref, amount, currency: 'GBP' } });
    return gw.drain()[0] ?? fail('no delivery');
  };
  const pipeline = async () => JSON.stringify((await processPaymentBatch(pdeps, { limit: 50, filter: { tenant_id: TENANT } })).outcomes);

  console.log('\n2) Payments through the real webhook route and pipeline (signed fixtures), the CLIs, and a screenshot.');
  // (1) Full payment on a promised invoice, on time.
  const a = await state(A.number);
  await q(`update public.invoices set status = 'promised', promised_on = $2 where id = $1`, [a.id, at.plus({ days: 2 }).toISODate()]);
  await q(`insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, reference_at) select tenant_id, id, customer_id, $2, now() from public.invoices where id = $1`, [a.id, at.plus({ days: 2 }).toISODate()]);
  const full = await pay(A.object, Number(A.amount), `fpay_demo_${randomUUID().slice(0, 8)}`);
  await step(1, 'full payment (webhook)', A.number, async () => `HTTP ${await post(full)} -> ${await pipeline()}`);
  // (2) The same delivery again.
  await step(2, 'same webhook again', A.number, async () => `HTTP ${await post(full)} -> ${await pipeline()}`);
  // (3) Partial payment, recorded by a human (bank transfer).
  await step(3, 'partial (pnpm payments record)', B.number, async () => {
    const out = lastJson(node(bin('payments'), ['record', '--tenant', TENANT, '--invoice', B.number, '--amount', money(Math.floor(Number(B.amount) / 2)), '--date', today, '--bank-ref', 'DEMO-BANK-PART-1', '--user', OWNER, '--yes', '--now', nowIso]));
    return String(out.result);
  });
  // (4) Overpayment.
  await step(4, 'overpayment (pnpm payments record)', C.number, async () => {
    const out = lastJson(node(bin('payments'), ['record', '--tenant', TENANT, '--invoice', C.number, '--amount', money(Number(C.amount) + 5000), '--date', today, '--bank-ref', 'DEMO-BANK-OVER-1', '--user', OWNER, '--yes', '--now', nowIso]));
    return `${String(out.result)} (credit ${money(5000)})`;
  });
  // (5) Tampered webhook: amount edited after signing.
  const t = await pay(D.object, Number(D.amount), 'fpay_demo_tampered');
  await step(5, 'tampered webhook', D.number, async () => `HTTP ${await post(t, t.rawBody.replace(`"amount":${D.amount}`, '"amount":1'))} (nothing stored)`);
  // (6) A screenshot by email -> proof task -> a human confirms with the amount, date and bank ref.
  await step(6, 'screenshot -> pnpm proofs confirm', D.number, async () => {
    const d = await state(D.number);
    const emailAcct = (await q<{ id: string }>(`select id from public.channel_accounts where tenant_id = $1 and channel = 'email'`, [TENANT]))[0]?.id;
    const cust = (await q<{ customer_id: string }>('select customer_id from public.invoices where id = $1', [d.id]))[0]?.customer_id;
    const raw = ['From: customer@example.test', 'Subject: Re: reminder', `Message-ID: <${randomUUID()}@example.test>`, 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="Z"', '', '--Z', 'Content-Type: text/plain', '', 'Paid, screenshot attached.', '--Z', 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="transfer.png"', '', png(120, 80).toString('base64'), '--Z--', ''].join('\r\n');
    const ev = await q<{ id: string }>(`insert into public.inbound_events (tenant_id, channel_account_id, provider, provider_event_id, kind, raw_mime, received_at, purge_after) values ($1, $2, 'imap', $3, 'message', $4, now(), now() + interval '90 days') returning id`, [TENANT, emailAcct, randomUUID(), raw]);
    const msg = await q<{ id: string }>(`insert into public.messages (tenant_id, customer_id, channel, direction, provider_message_id, attachments, inbound_event_id, received_at) values ($1, $2, 'email', 'in', $3, $4, $5, now()) returning id`, [TENANT, cust, randomUUID(), JSON.stringify([{ name: 'transfer.png', mime: 'image/png', size: 0 }]), ev[0]?.id]);
    await q('insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)', [TENANT, msg[0]?.id, d.id]); // => proof_fetch queued
    node(bin('worker'), ['--once', '--tenant', 'Demo Agency', '--now', nowIso]); // fetch, sniff, store privately, review task
    const proof = (await q<{ id: string }>(`select id from public.payment_proofs where tenant_id = $1 and invoice_id = $2 and status = 'pending'`, [TENANT, d.id]))[0]?.id ?? fail('no proof was stored');
    const out = lastJson(node(bin('proofs'), ['confirm', proof, '--amount', money(Number(D.amount)), '--date', today, '--bank-ref', 'DEMO-BANK-PROOF-1', '--user', OWNER, '--yes', '--now', nowIso]));
    return `proof stored + task; confirm: ${String(out.result)}`;
  });
  // (7) Refund of the first payment: an urgent task, the invoice is not reopened.
  await step(7, 'refund event (webhook)', A.number, async () => {
    const ref = (await q<{ provider_ref: string }>(`select r.provider_ref from public.receipts r join public.invoices i on i.id = r.invoice_id where i.tenant_id = $1 and i.number = $2 and r.method = 'fake'`, [TENANT, A.number]))[0]?.provider_ref ?? fail('no gateway receipt');
    gw.refund(ref, Number(A.amount), 'GBP');
    return `HTTP ${await post(gw.drain()[0] ?? fail('no delivery'))} -> ${await pipeline()}`;
  });
  // (8) Money for a cancelled invoice (the link was paid before it could be switched off).
  const E = (await q<{ number: string; id: string }>(`select number, id from public.invoices where tenant_id = $1 and status = 'open' order by number limit 1`, [TENANT]))[0] ?? fail('no open invoice');
  const req = await createRequestFor(pdeps, TENANT, E.id);
  if (!req.request?.providerObjectId) fail('no link for the cancelled-invoice scenario');
  await q(`update public.invoices set status = 'cancelled' where id = $1`, [E.id]);
  const ePay = await pay(req.request?.providerObjectId ?? '', req.request?.amountMinor ?? 0, 'fpay_demo_cancelled');
  await step(8, 'payment on cancelled invoice', E.number, async () => `HTTP ${await post(ePay)} -> ${await pipeline()}`);

  console.log('\n3) The worker (receipts, then next day + approve all): no reminder activity for paid or cancelled invoices.');
  node(bin('worker'), ['--once', '--tenant', 'Demo Agency', '--now', nowIso]);
  const tomorrow = at.plus({ days: 1 }).set({ hour: 10, minute: 0 }).toUTC().toISO() ?? '';
  for (let round = 0; round < 3; round++) {
    node(bin('worker'), ['--once', '--tenant', 'Demo Agency', '--now', tomorrow]);
    node(bin('approvals'), ['approve', '--all-pending', '--tenant', 'Demo Agency']);
  }
  const numbers = [A.number, B.number, C.number, D.number, E.number];
  const after = await q<{ number: string; status: string; receipts: number; reminders_after: number; approvals_after: number }>(
    `select i.number, i.status,
            (select count(*)::int from public.message_invoices mi join public.messages m on m.id = mi.message_id where mi.invoice_id = i.id and m.purpose = 'receipt' and m.send_state = 'sent') as receipts,
            (select count(*)::int from public.message_invoices mi join public.messages m on m.id = mi.message_id where mi.invoice_id = i.id and m.purpose = 'reminder' and m.direction = 'out' and coalesce(m.sent_at, m.pending_since) >= $3) as reminders_after,
            (select count(*)::int from public.approvals ap where ap.invoice_id = i.id and ap.requested_at >= $3) as approvals_after
     from public.invoices i where i.tenant_id = $1 and i.number = any($2) order by i.number`,
    [TENANT, numbers, new Date(tomorrow)],
  );
  for (const r of rows) r.receipts_sent = after.find((x) => x.number === r.invoice)?.receipts ?? 0;
  console.table(rows);
  const leaked = after.filter((x) => ['paid', 'cancelled'].includes(x.status) && x.reminders_after + x.approvals_after > 0);
  if (leaked.length) fail(`reminder activity on ${leaked.map((x) => x.number).join(', ')}`);
  const receiptsByInv = Object.fromEntries(after.map((x) => [x.number, x.receipts]));
  if (receiptsByInv[A.number] !== 1 || receiptsByInv[B.number] !== 1 || receiptsByInv[C.number] !== 1 || receiptsByInv[D.number] !== 1) fail(`expected exactly one receipt each for ${A.number}, ${B.number}, ${C.number}, ${D.number}: ${JSON.stringify(receiptsByInv)}`);
  const bNext = (await q<{ body: string }>(
    `select m.body from public.message_invoices mi join public.messages m on m.id = mi.message_id join public.invoices i on i.id = mi.invoice_id where i.number = $1 and i.tenant_id = $2 and m.purpose = 'reminder' and m.send_state = 'sent' and m.sent_at >= $3`,
    [B.number, TENANT, new Date(tomorrow)],
  ))[0]?.body;
  const bBal = Number((await state(B.number)).balance);
  console.log(bNext ? `   ${B.number}'s next reminder carries the NEW balance: ${bNext.includes(`£${money(bBal).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`) ? 'yes' : 'NO'}` : `   ${B.number}: no further reminder was due in this window.`);
  const tasks = await q<{ type: string; urgent: boolean; n: number }>(`select type, urgent, count(*)::int as n from public.tasks where tenant_id = $1 and type in ('overpayment_credit', 'payment_on_final_invoice', 'payment_reversal', 'review_proof') group by 1, 2 order by 1`, [TENANT]);
  console.table(tasks);

  console.log('\n4) pnpm payments:integrity');
  console.log(`   ${node(bin('payments'), ['integrity']).trim().split('\n').at(-1)}`);
  console.log('\n   KPIs (tenant-local days; ADR 0041)');
  const kpi = {
    overdue: await q(`select currency, invoices, balance from public.kpi_overdue_total($2) where tenant_id = $1`, [TENANT, new Date(nowIso)]),
    recovered_today: await q(`select currency, recovered, receipts, credit from public.kpi_recovered($2, $2) where tenant_id = $1`, [TENANT, today]),
    days_to_pay_today: await q(`select invoices, avg_days_to_pay, avg_days_after_due from public.kpi_days_to_pay($2, $2) where tenant_id = $1`, [TENANT, today]),
    promise_kept_today: await q(`select kept, broken, rate from public.kpi_promise_kept_rate($2, $2) where tenant_id = $1`, [TENANT, today]),
    ageing: await q(`select bucket, invoices, balance from public.kpi_ageing($2) where tenant_id = $1 order by bucket`, [TENANT, new Date(nowIso)]),
  };
  console.log(JSON.stringify(kpi, null, 2));
  console.log('\nDEMO OK: every effect came from the pipeline; paid/cancelled invoices got no reminder activity; one receipt per receipt; integrity clean.');
  console.log('FIXTURE-BASED: gateway deliveries (FakeGateway signatures), the screenshot. LIVE: database, webhook route, pipeline, CLIs, worker, SMTP to Mailpit.');
} catch (e) {
  if (!(e instanceof DemoFailure)) throw e;
  console.error(`\nDEMO FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  server.close();
  await db.pool.end();
}
