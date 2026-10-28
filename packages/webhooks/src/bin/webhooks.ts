// pnpm webhooks — the WhatsApp webhook endpoint. Needs WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN (env only,
// never logged). Database: WORKER_DATABASE_URL, else the local stack. Live Meta delivery needs a public HTTPS
// URL in front of this (a tunnel or a reverse proxy): that part is manual (ADR 0023).
import pg from 'pg';
import { localEnv } from '../../../db/scripts/local-env.ts';
import { DEFAULT_WEBHOOK_CONFIG, createWebhookServer, pgWebhookStore } from '../index.ts';

const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
if (!appSecret || !verifyToken) {
  console.error('set WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL ?? localEnv().dbUrl, max: 4, application_name: 'dueloop-webhooks' });
const server = createWebhookServer({
  store: pgWebhookStore(pool),
  config: { ...DEFAULT_WEBHOOK_CONFIG, appSecret, verifyToken },
  now: () => new Date(),
  log: (event, fields) => process.stdout.write(`${JSON.stringify({ level: 'info', event, at: new Date().toISOString(), ...fields })}\n`),
});
const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => process.stdout.write(`${JSON.stringify({ level: 'info', event: 'listening', port })}\n`));
const stop = () => server.close(() => void pool.end());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
