// Helper for the automated demo (apps/web e2e:demo): the two steps that run in-process in the existing demos.
//   node e2e-demo-steps.ts reply <tenantId> <invoiceNumber> <fromAddress> <bodyBase64> <atIso>
//     a customer email, stored as the IMAP poller stores it (threaded to our reminder's Message-ID), then the REAL
//     inbound processor with the deterministic scripted classifier (as `pnpm demo:replies`).
//   node e2e-demo-steps.ts pay-webhook <whToken> <whSecret> <providerObjectId> <amountMinor> <currency>
//     the REAL webhook HTTP server, in-process, receives a signed FakeGateway link.paid delivery.
// Demo/test tooling only: not imported by any service entry point.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { pgImapStore } from '@dueloop/adapters-email';
import { FakeGateway } from '@dueloop/adapters-payments';
import { processInboundBatch } from '@dueloop/inbound';
import { ingestPaymentWebhook } from '@dueloop/payments';
import { createWebhookServer, DEFAULT_WEBHOOK_CONFIG, pgWebhookStore } from '@dueloop/webhooks';
import { KeywordBaselineClassifier } from '../../classifier/eval/keyword-baseline.ts';
import { buildInboundDeps } from '../src/inbound-runtime.ts';
import { buildPaymentsDeps, openDb } from '../src/runtime.ts';

const [cmd, ...args] = process.argv.slice(2);
const db = openDb(process.env);
const out = (o: unknown) => process.stdout.write(`${JSON.stringify(o)}\n`);

try {
  if (cmd === 'reply') {
    const [tenant, number, from, bodyB64, atIso] = args as [string, string, string, string, string];
    const at = new Date(atIso);
    const rfc = (
      await db.pool.query<{ rfc: string }>(
        `select m.rfc_message_id as rfc from public.messages m join public.message_invoices mi on mi.message_id = m.id
         join public.invoices i on i.id = mi.invoice_id where i.tenant_id = $1 and i.number = $2 and m.direction = 'out' and m.send_state = 'sent'
         order by m.sent_at desc limit 1`,
        [tenant, number],
      )
    ).rows[0]?.rfc;
    const acct = (await db.pool.query<{ id: string }>(`select id from public.channel_accounts where tenant_id = $1 and channel = 'email'`, [tenant])).rows[0]?.id;
    if (!rfc || !acct) throw new Error('no sent reminder or no email account');
    const id = `<reply-${randomUUID()}@customer.example.test>`;
    const raw = [`From: ${from}`, 'To: billing@fresh-demo.test', 'Subject: Re: invoice reminder', `Message-ID: ${id}`, `In-Reply-To: ${rfc}`, `Date: ${at.toUTCString()}`, 'Content-Type: text/plain; charset=utf-8', '', Buffer.from(bodyB64, 'base64').toString('utf8'), ''].join('\r\n');
    await pgImapStore(db.pool).store(acct, id, null, raw, at);
    const keyword = new KeywordBaselineClassifier('reply-v1');
    const scripted = {
      promptVersion: 'demo-script',
      classify: async (input: Parameters<typeof keyword.classify>[0]) => {
        const r = await keyword.classify(input);
        return r.ok ? { ...r, modelId: 'demo-script', raw: { ...(r.raw as Record<string, unknown>), confidence: 0.95 } } : r;
      },
    };
    const deps = buildInboundDeps(process.env, db, { now: () => at }, scripted);
    out(await processInboundBatch(deps, { limit: 20, filter: { tenant_id: tenant } }));
  } else if (cmd === 'pay-webhook') {
    const [token, secret, link, amount, currency] = args as [string, string, string, string, string];
    const clock = { now: () => new Date() };
    const pdeps = buildPaymentsDeps(process.env, db, clock);
    const server = createWebhookServer({ store: pgWebhookStore(db.pool), config: { ...DEFAULT_WEBHOOK_CONFIG, appSecret: '', verifyToken: '' }, now: () => clock.now(), log: () => undefined, payments: (t, raw, h) => ingestPaymentWebhook(pdeps, t, raw, h) });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const gw = new FakeGateway({ secret, clock });
    gw.forge({ type: 'link.paid', data: { link, payment: `fpay_e2e_${randomUUID().slice(0, 8)}`, amount: Number(amount), currency } });
    const d = gw.drain()[0];
    if (!d) throw new Error('no delivery');
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/payments/${token}`, { method: 'POST', body: d.rawBody, headers: d.headers });
    await new Promise((res) => server.close(res));
    out({ status: r.status });
  } else {
    console.error('usage: e2e-demo-steps.ts reply ... | pay-webhook ...');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : 'failed');
  process.exitCode = 1;
} finally {
  await db.pool.end();
}
