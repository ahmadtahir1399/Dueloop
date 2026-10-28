// Test harness for the worker against the REAL local database: fresh tenants, a fake channel, a fake clock.
import { randomUUID } from 'node:crypto';
import type { Channel } from '@dueloop/core';
import type { OutboundChannel, OutboundEnvelope, SendOutcome } from '@dueloop/messaging';
import pg from 'pg';
import { localEnv } from '../../db/scripts/local-env.ts';
import { WorkerDb } from '../src/db.ts';
import { createJsonLogger } from '../src/logger.ts';
import { MemoryNotifier } from '../src/memory-notifier.ts';
import { DEFAULT_CONFIG, NO_FAILPOINTS, type Failpoints, type FailpointName, type WorkerConfig } from '../src/ports.ts';
import { processBatch, sweep, type BatchResult, type WorkerDeps } from '../src/process.ts';

export const pool = new pg.Pool({ connectionString: localEnv().dbUrl, max: 8 });
export const db = new WorkerDb(pool);

export async function q<R extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
  return (await pool.query<R>(sql, params)).rows;
}

/** Tests own the clock: cron must not enqueue behind their back. */
export async function quietCron(): Promise<void> {
  await q(`update private.system_flags set enabled = false where key = 'cron_enabled'`);
}

export class FakeClock {
  t: Date;
  constructor(iso: string) {
    this.t = new Date(iso);
  }
  now = () => new Date(this.t.getTime());
  set(iso: string) {
    this.t = new Date(iso);
  }
  advanceMinutes(m: number) {
    this.t = new Date(this.t.getTime() + m * 60_000);
  }
}

export type Script = SendOutcome | 'hang' | ((env: OutboundEnvelope) => SendOutcome | 'hang');

export class FakeChannel implements OutboundChannel {
  readonly calls: OutboundEnvelope[] = [];
  next: Script[] = [];
  fallback: Script = { kind: 'sent', providerMessageId: null };
  readonly channel: Channel;
  onSend: ((env: OutboundEnvelope) => void | Promise<void>) | null = null;
  constructor(channel: Channel) {
    this.channel = channel;
  }
  async send(env: OutboundEnvelope): Promise<SendOutcome> {
    this.calls.push(env);
    await this.onSend?.(env);
    const s = this.next.shift() ?? this.fallback;
    const r = typeof s === 'function' ? s(env) : s;
    if (r === 'hang') return new Promise<SendOutcome>(() => undefined);
    return r.kind === 'sent' ? { kind: 'sent', providerMessageId: r.providerMessageId ?? `fake-${this.calls.length}` } : r;
  }
  keys(): string[] {
    return this.calls.map((c) => c.idempotencyKey);
  }
}

export class FailpointCrash extends Error {
  constructor(point: FailpointName) {
    super(`failpoint ${point}`);
    this.name = 'FailpointCrash';
  }
}

/** Crashes (throws) the first time the named point is reached for a key; then disarms. */
export function crashAt(point: FailpointName): Failpoints & { fired: number } {
  const fp = {
    fired: 0,
    hit(name: FailpointName) {
      if (name === point && fp.fired === 0) {
        fp.fired++;
        throw new FailpointCrash(name);
      }
    },
  };
  return fp;
}

type Overrides = Omit<Partial<WorkerDeps>, 'config'> & { config?: Partial<WorkerConfig> };

export interface World {
  tenantId: string;
  customerId: string;
  invoiceIds: string[];
  clock: FakeClock;
  email: FakeChannel;
  whatsapp: FakeChannel;
  notifier: MemoryNotifier;
  logs: string[];
  deps: (over?: Overrides) => WorkerDeps;
  run: (over?: Overrides) => Promise<BatchResult>;
  sweep: () => Promise<{ unknown: number; expired: number }>;
}

export interface WorldOptions {
  clock?: string;
  approvalMode?: 'always' | 'never' | 'low_confidence';
  invoices?: { dueOn: string; number?: string }[];
  steps?: { id: string; daysAfterDue: number; channel: Channel; templateKey: string }[];
  maxPerWeek?: number;
  budgetMinor?: number;
  customer?: { email?: string | null; phone?: string | null; optedOut?: boolean; language?: string };
  holidays?: string[];
  templates?: boolean;
  emailAccount?: boolean;
  whatsappConsent?: boolean;
  /** N invoices due 2026-06-01 (ignored when `invoices` is given). */
  count?: number;
  /** Each invoice gets its own customer (so the weekly cap does not throttle a batch). */
  separateCustomers?: boolean;
}

export async function world(o: WorldOptions = {}): Promise<World> {
  const tenantId = randomUUID();
  await q(
    `insert into public.tenants (id, name, timezone, currency, quiet_start_hour, quiet_end_hour, approval_mode, monthly_message_budget_minor, bank_instructions)
     values ($1, 'Test Co', 'Europe/London', 'GBP', 20, 9, $2, $3, 'IBAN GB00 TEST')`,
    [tenantId, o.approvalMode ?? 'never', o.budgetMinor ?? 0],
  );
  const steps = o.steps ?? [
    { id: 's1', daysAfterDue: 1, channel: 'email', templateKey: 'friendly' },
    { id: 's2', daysAfterDue: 7, channel: 'email', templateKey: 'nudge' },
    { id: 's3', daysAfterDue: 14, channel: 'email', templateKey: 'firm' },
  ];
  await q(
    `insert into public.policies (tenant_id, name, steps, escalate_after_days, grace_days_after_promise, max_messages_per_week, is_default)
     values ($1, 'P', $2, 60, 2, $3, true)`,
    [tenantId, JSON.stringify(steps), o.maxPerWeek ?? 3],
  );
  for (const h of o.holidays ?? []) await q('insert into public.holidays (tenant_id, on_date) values ($1, $2)', [tenantId, h]);
  if (o.templates !== false) {
    for (const [key, channel, subject] of [
      ['friendly', 'email', 'Reminder {{invoice_number}}'],
      ['nudge', 'email', 'Overdue {{invoice_number}}'],
      ['firm', 'email', 'Action needed {{invoice_number}}'],
    ]) {
      await q(
        `insert into public.templates (tenant_id, template_key, channel, locale, tone, subject, body)
         values ($1, $2, $3, 'en', 'neutral', $4, 'Hi {{customer_name}}, {{invoice_number}} for {{amount_due}} was due {{due_date}}. Ref {{reference_code}}. {{pay_link}}')`,
        [tenantId, key, channel, subject],
      );
    }
    await q(
      `insert into public.templates (tenant_id, template_key, channel, locale, tone, body, provider_template_name, provider_language, provider_status)
       values ($1, 'wa', 'whatsapp', 'en', 'neutral', 'Hi {{customer_name}}, {{invoice_number}} is due.', 'payment_reminder', 'en_US', 'approved')`,
      [tenantId],
    );
  }
  if (o.emailAccount !== false) {
    await q(`insert into public.channel_accounts (tenant_id, channel, config) values ($1, 'email', $2)`, [
      tenantId,
      JSON.stringify({ from_address: 'billing@test-co.example', from_name: 'Test Co', message_id_domain: 'test-co.example' }),
    ]);
  }
  await q(`insert into public.channel_accounts (tenant_id, channel, config) values ($1, 'whatsapp', '{"phone_number_id": "1"}')`, [tenantId]);
  const customerId = randomUUID();
  await q(`insert into public.customers (id, tenant_id, display_name, email, phone_e164, opted_out, language) values ($1, $2, 'Ada Customer', $3, $4, $5, $6)`, [
    customerId,
    tenantId,
    o.customer?.email === undefined ? 'ada@customer.example' : o.customer.email,
    o.customer?.phone === undefined ? '+447700900123' : o.customer.phone,
    o.customer?.optedOut ?? false,
    o.customer?.language ?? 'en',
  ]);
  if (o.whatsappConsent) {
    await q(`insert into public.customer_consents (tenant_id, customer_id, channel, granted_at, source) values ($1, $2, 'whatsapp', now(), 'test')`, [tenantId, customerId]);
  }
  const invoiceIds: string[] = [];
  const invoiceList: { dueOn: string; number?: string }[] = o.invoices ?? (o.count ? Array.from({ length: o.count }, () => ({ dueOn: '2026-06-01' })) : [{ dueOn: '2026-06-01' }]);
  for (const [i, inv] of invoiceList.entries()) {
    const id = randomUUID();
    let owner = customerId;
    if (o.separateCustomers && i > 0) {
      owner = randomUUID();
      await q(`insert into public.customers (id, tenant_id, display_name, email) values ($1, $2, $3, $4)`, [owner, tenantId, `Customer ${i}`, `c${i}@customer.example`]);
    }
    await q(
      `insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code, next_action_at)
       values ($1, $2, $3, $4, 125050, 'GBP', '2026-05-01', $5, $6, '2000-01-01')`,
      [id, tenantId, owner, inv.number ?? `T-${i + 1}`, inv.dueOn, `REF${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`],
    );
    invoiceIds.push(id);
  }

  const clock = new FakeClock(o.clock ?? '2026-06-10T09:00:00Z'); // 10:00 London (BST)
  const email = new FakeChannel('email');
  const whatsapp = new FakeChannel('whatsapp');
  const notifier = new MemoryNotifier();
  const logs: string[] = [];
  const deps = (over: Overrides = {}): WorkerDeps => ({
    db,
    clock,
    channels: { get: (ch) => (ch === 'email' ? email : ch === 'whatsapp' ? whatsapp : undefined) },
    notifier,
    limiter: { tryTake: () => 0 },
    logger: createJsonLogger((l) => logs.push(l), () => clock.now().toISOString()),
    failpoints: NO_FAILPOINTS,
    ...over,
    config: { ...DEFAULT_CONFIG, jitterMinutes: 0, sendTimeoutMs: 300, ...over.config },
  });
  return {
    tenantId,
    customerId,
    invoiceIds,
    clock,
    email,
    whatsapp,
    notifier,
    logs,
    deps,
    run: async (over) => {
      const d = deps(over);
      await d.db.enqueue(1000, clock.now());
      return processBatch(d, { limit: 100, filter: { tenant_id: tenantId } });
    },
    sweep: () => sweep(deps()),
  };
}

/** Make every job of a tenant visible again (as if the visibility timeout passed). */
export async function expireVisibility(tenantId: string): Promise<void> {
  await q(`update pgmq.q_followup_actions set vt = now() - interval '1 second' where message ->> 'tenant_id' = $1`, [tenantId]);
}

export const invoice = (id: string) =>
  q<{ status: string; next_action_at: Date; parked_reason: string | null }>('select status, next_action_at, parked_reason from public.invoices where id = $1', [id]).then((r) => r[0]);

export const messagesOf = (tenantId: string) =>
  q<{ idempotency_key: string; send_state: string; attempt: number; failed_reason: string | null; rfc_message_id: string | null; id: string }>(
    'select id, idempotency_key, send_state, attempt, failed_reason, rfc_message_id from public.messages where tenant_id = $1 order by idempotency_key',
    [tenantId],
  );

export const eventsOf = (tenantId: string) =>
  q<{ type: string; idempotency_key: string }>('select type, idempotency_key from public.invoice_events where tenant_id = $1 order by id', [tenantId]);
