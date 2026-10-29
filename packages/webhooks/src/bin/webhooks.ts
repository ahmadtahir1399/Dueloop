// pnpm webhooks: the webhook runtime. WhatsApp (/webhooks/whatsapp) needs WHATSAPP_APP_SECRET and
// WHATSAPP_VERIFY_TOKEN; payments (/webhooks/payments/<token>) need PAYMENTS_WEBHOOKS=true and a payment account
// whose secret is in Vault. Env only, never logged. Database: WORKER_DATABASE_URL, else the local stack. Live
// provider delivery needs a public HTTPS URL in front of this (a tunnel or a reverse proxy): manual (ADR 0023).
import { DEFAULT_PAYMENTS_CONFIG, NO_PAYMENT_FAILPOINTS, PaymentsDb, accountProviders, ingestPaymentWebhook, type PaymentsDeps } from '@dueloop/payments';
import { assertSchema, heartbeat, SchemaMismatch } from '@dueloop/ops';
import pg from 'pg';
import { localEnv } from '../../../db/scripts/local-env.ts';
import { DEFAULT_WEBHOOK_CONFIG, createWebhookServer, pgWebhookStore } from '../index.ts';

const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
const payments = process.env.PAYMENTS_WEBHOOKS === 'true';
if ((!appSecret || !verifyToken) && !payments) {
  console.error('set WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN, and/or PAYMENTS_WEBHOOKS=true');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL ?? localEnv().dbUrl, max: 4, application_name: 'dueloop-webhooks' });
// Rule 45: refuse to start on a schema mismatch (precise reason, no values).
try {
  await assertSchema(pool);
} catch (e) {
  console.error(e instanceof Error ? e.message : 'schema check failed');
  await pool.end();
  process.exit(1);
}
const log = (event: string, fields: Readonly<Record<string, string | number | boolean | null>> = {}) =>
  process.stdout.write(`${JSON.stringify({ level: 'info', event, at: new Date().toISOString(), ...fields })}\n`);
const clock = { now: () => new Date() };
const pdb = new PaymentsDb(pool);
const paymentsDeps: PaymentsDeps = {
  db: pdb,
  clock,
  logger: { info: log, warn: log, error: log },
  notifier: { notify: async () => undefined }, // ingest only stores; alerts come from the pipeline
  providers: accountProviders(process.env, pdb, clock),
  failpoints: NO_PAYMENT_FAILPOINTS,
  config: DEFAULT_PAYMENTS_CONFIG,
};
const server = createWebhookServer({
  store: pgWebhookStore(pool),
  config: { ...DEFAULT_WEBHOOK_CONFIG, appSecret: appSecret && verifyToken ? appSecret : '', verifyToken },
  now: () => new Date(),
  log,
  ready: async () => {
    try {
      await assertSchema(pool);
      await heartbeat(pool, 'webhooks', true, {}, new Date());
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof SchemaMismatch ? 'schema_mismatch' : 'database_unreachable' };
    }
  },
  ...(payments ? { payments: (token: string, raw: string, headers: Readonly<Record<string, string>>) => ingestPaymentWebhook(paymentsDeps, token, raw, headers) } : {}),
});
const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => process.stdout.write(`${JSON.stringify({ level: 'info', event: 'listening', port })}\n`));
const stop = () => server.close(() => void pool.end());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
