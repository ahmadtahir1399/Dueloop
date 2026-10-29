// Operations (prompt 7 step 2): schema-version guard (rule 45), heartbeats, status, watchdog, error reporting.
import { hostname } from 'node:os';
import type pg from 'pg';

/**
 * The migration this build was written against. A test fails if it is not the newest file in supabase/migrations,
 * so every new migration bumps it in the same commit.
 */
export const EXPECTED_SCHEMA_VERSION = '0025';
export const APP_VERSION = '0.7.0';

export class SchemaMismatch extends Error {}

/** Throws a precise, value-free message when the database is not at the schema this build expects. */
export async function assertSchema(pool: pg.Pool, expected = EXPECTED_SCHEMA_VERSION): Promise<string> {
  let applied: string | null;
  try {
    applied = (await pool.query<{ v: string | null }>('select private.schema_version() as v')).rows[0]?.v ?? null;
  } catch {
    throw new SchemaMismatch(`cannot read the schema version (database unreachable, or migrations older than ${expected}); see docs/runbook.md "Upgrades"`);
  }
  if (applied !== expected) {
    const how = applied !== null && applied < expected ? 'apply the pending migrations (backup first)' : 'deploy the build that matches the database';
    throw new SchemaMismatch(`database schema is ${applied ?? 'unknown'}, this build expects ${expected}: ${how}. Refusing to start (docs/runbook.md "Upgrades").`);
  }
  return applied;
}

export type ServiceName = 'web' | 'worker' | 'processor' | 'webhooks' | 'payments';
export const INSTANCE_ID = `${hostname().slice(0, 60)}:${process.pid}`;

export async function heartbeat(pool: pg.Pool, service: ServiceName, ok: boolean, details: Record<string, string | number | boolean | null>, now: Date): Promise<void> {
  await pool.query('select private.heartbeat($1, $2, $3, $4, $5, $6)', [service, INSTANCE_ID, APP_VERSION, ok, JSON.stringify(details), now]);
}

export interface Heartbeat {
  service: string;
  instance: string;
  version: string;
  seen_seconds_ago: number;
  ok_seconds_ago: number | null;
}
export interface OpsStatus {
  schema_version: string | null;
  queue_depth: number;
  queue_oldest_seconds: number;
  due_not_enqueued: number;
  parked_invoices: number;
  unknown_messages: number;
  dead_letters_24h: number;
  pending_approvals: number;
  oldest_pending_approval_hours: number;
  unprocessed_inbound: number;
  unprocessed_payment_events: number;
  paused_tenants: number;
  global_paused: boolean;
  heartbeats: Heartbeat[];
}

export async function opsStatus(pool: pg.Pool, now: Date): Promise<OpsStatus> {
  const r = await pool.query<{ s: OpsStatus }>('select private.ops_status($1) as s', [now]);
  const s = r.rows[0]?.s;
  if (!s) throw new Error('ops_status returned nothing');
  return s;
}

export interface Thresholds {
  staleHeartbeatSeconds: number;
  queueOldestSeconds: number;
  dueNotEnqueued: number;
  unknownMessages: number;
  deadLetters24h: number;
  unprocessedInbound: number;
  unprocessedPaymentEvents: number;
  /** Services that must have a fresh heartbeat. */
  required: readonly string[];
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  staleHeartbeatSeconds: 300,
  queueOldestSeconds: 1800,
  dueNotEnqueued: 500,
  unknownMessages: 1,
  deadLetters24h: 1,
  unprocessedInbound: 200,
  unprocessedPaymentEvents: 50,
  required: ['worker'],
};

export interface Finding {
  key: string;
  severity: 'warning' | 'critical';
  message: string;
}

/** Pure: status + thresholds -> findings. Messages hold counts and names only. */
export function evaluate(s: OpsStatus, t: Thresholds = DEFAULT_THRESHOLDS): Finding[] {
  const f: Finding[] = [];
  for (const svc of t.required) {
    const beats = s.heartbeats.filter((h) => h.service === svc);
    const fresh = beats.some((h) => h.seen_seconds_ago <= t.staleHeartbeatSeconds);
    if (!fresh) f.push({ key: `heartbeat:${svc}`, severity: 'critical', message: beats.length ? `${svc}: no heartbeat for ${Math.min(...beats.map((b) => b.seen_seconds_ago))} s` : `${svc}: never reported a heartbeat` });
  }
  const gt = (key: string, v: number, limit: number, msg: string, severity: Finding['severity'] = 'warning') => {
    if (v >= limit) f.push({ key, severity, message: msg });
  };
  gt('queue_oldest', s.queue_oldest_seconds, t.queueOldestSeconds, `oldest queued job waits ${s.queue_oldest_seconds} s`, 'critical');
  gt('due_not_enqueued', s.due_not_enqueued, t.dueNotEnqueued, `${s.due_not_enqueued} invoices are due but not queued`);
  gt('unknown_messages', s.unknown_messages, t.unknownMessages, `${s.unknown_messages} messages in an unknown state need a human`);
  gt('dead_letters', s.dead_letters_24h, t.deadLetters24h, `${s.dead_letters_24h} dead letters in 24 h`);
  gt('unprocessed_inbound', s.unprocessed_inbound, t.unprocessedInbound, `${s.unprocessed_inbound} inbound events not processed`);
  gt('unprocessed_payment_events', s.unprocessed_payment_events, t.unprocessedPaymentEvents, `${s.unprocessed_payment_events} payment events not processed`, 'critical');
  return f;
}

/** True the first time a finding is seen in this period (hour), so alerts are not repeated every run. */
export async function firstAlert(pool: pg.Pool, key: string, now: Date): Promise<boolean> {
  const period = now.toISOString().slice(0, 13);
  const r = await pool.query('insert into private.ops_alerts (dedupe_key, period) values ($1, $2) on conflict do nothing', [key, period]);
  return (r.rowCount ?? 0) === 1;
}

export * from './error-reporter.ts';
