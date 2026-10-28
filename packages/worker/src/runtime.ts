// Composition root for the production worker and the ops CLIs. This is the ONLY place real adapters are
// wired, and it can only ever construct NO_FAILPOINTS (tested): failpoints are unreachable in production.
import { createSmtpChannel, smtpDefaultsFromEnv } from '@dueloop/adapters-email';
import { createEmailAlertNotifier, createSlackNotifier, fanout, slackOrEmail } from '@dueloop/adapters-notify';
import { createWhatsAppChannel } from '@dueloop/adapters-whatsapp';
import { DEFAULT_RATE_LIMIT, TokenBucketLimiter, type OutboundChannel } from '@dueloop/messaging';
import pg from 'pg';
import { localEnv } from '../../db/scripts/local-env.ts';
import { WorkerDb } from './db.ts';
import { createJsonLogger, type Logger } from './logger.ts';
import { DEFAULT_CONFIG, NO_FAILPOINTS, type Clock, type WorkerConfig } from './ports.ts';
import type { WorkerDeps } from './process.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * WORKER_DATABASE_URL, else the LOCAL stack from `supabase status`. Deliberately never DATABASE_URL: that
 * one points at the hosted project, and the worker must not send from there by accident.
 */
export function databaseUrl(env: Env): string {
  return env.WORKER_DATABASE_URL ?? localEnv().dbUrl;
}

export function openDb(env: Env): WorkerDb {
  return new WorkerDb(new pg.Pool({ connectionString: databaseUrl(env), max: 4, application_name: 'dueloop-worker' }));
}

export function stdoutLogger(clock: Clock): Logger {
  return createJsonLogger((line) => process.stdout.write(`${line}\n`), () => clock.now().toISOString());
}

/** A fixed instant (ops/demo `--now`) that still moves forward with real time, or the system clock. */
export function clockFrom(nowIso: string | undefined): Clock {
  if (!nowIso) return { now: () => new Date() };
  const base = new Date(nowIso);
  if (Number.isNaN(base.getTime())) throw new Error('--now must be an ISO timestamp');
  const started = Date.now();
  return { now: () => new Date(base.getTime() + (Date.now() - started)) };
}

export function buildDeps(env: Env, db: WorkerDb, clock: Clock, overrides: Partial<WorkerConfig> = {}): WorkerDeps {
  const config: WorkerConfig = { ...DEFAULT_CONFIG, ...overrides };
  const logger = stdoutLogger(clock);
  const adapterTimeout = Math.max(1000, config.sendTimeoutMs - 2000); // below the worker's hard timeout
  const channels = new Map<string, OutboundChannel>();
  const email = createSmtpChannel({ defaults: smtpDefaultsFromEnv(env), timeoutMs: adapterTimeout, allowTenantHost: env.SMTP_ALLOW_TENANT_HOST === 'true' });
  channels.set('email', email);
  if (env.WHATSAPP_GRAPH_VERSION) channels.set('whatsapp', createWhatsAppChannel({ graphVersion: env.WHATSAPP_GRAPH_VERSION, timeoutMs: adapterTimeout }));
  const onError = (reason: string) => logger.warn('alert_delivery', { reason });
  const slack = createSlackNotifier({ webhookFor: (t) => db.secret(t, 'slack'), timeoutMs: 5000, onError });
  // Tenants without a Slack webhook get alerts by email to their owners, through their own email account.
  const emailAlerts = createEmailAlertNotifier({
    channel: email,
    accountFor: async (t) =>
      (await db.pool.query<{ config: Record<string, unknown> }>(`select config from public.channel_accounts where tenant_id = $1 and channel = 'email' and enabled`, [t])).rows[0]?.config ?? null,
    credentialsFor: (t) => db.secret(t, 'email'),
    recipientsFor: async (t) =>
      (
        await db.pool.query<{ email: string }>(
          `select u.email from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = $1 and m.role = 'owner' and u.email is not null order by u.email`,
          [t],
        )
      ).rows.map((r) => r.email),
    onError,
  });
  const alerts = slackOrEmail(async (t) => (await db.secret(t, 'slack')) !== null, slack, emailAlerts);
  const logAlerts = { notify: async (a: { tenantId: string; kind: string; severity: string }) => logger.warn('alert', { tenantId: a.tenantId, reason: a.kind, outcome: a.severity }) };
  return {
    db,
    clock,
    channels: { get: (ch) => channels.get(ch) },
    notifier: fanout(logAlerts, alerts),
    limiter: new TokenBucketLimiter(() => DEFAULT_RATE_LIMIT, () => clock.now().getTime()),
    logger,
    failpoints: NO_FAILPOINTS,
    config,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A tenant by id or exact name. */
export async function resolveTenant(db: WorkerDb, ref: string): Promise<string> {
  const r = UUID.test(ref)
    ? await db.pool.query<{ id: string }>('select id from public.tenants where id = $1', [ref])
    : await db.pool.query<{ id: string }>('select id from public.tenants where name = $1', [ref]);
  if (r.rows.length !== 1) throw new Error(`tenant not found (or ambiguous): ${ref}`);
  return r.rows[0]?.id ?? '';
}
