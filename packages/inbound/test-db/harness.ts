// Inbound test harness against the REAL local database: a tenant with sent reminders, raw events stored
// through private.store_inbound_event (as the webhook/IMAP store does), a scripted classifier, a fake clock.
import { randomUUID } from 'node:crypto';
import { FakeClassifier, type ClassifierInput } from '@dueloop/classifier';
import type { Alert } from '@dueloop/messaging';
import pg from 'pg';
import { localEnv } from '../../db/scripts/local-env.ts';
import { InboundDb } from '../src/db.ts';
import { processInboundBatch, type InboundBatchResult } from '../src/pipeline.ts';
import { DEFAULT_INBOUND_CONFIG, NO_INBOUND_FAILPOINTS, type InboundConfig, type InboundDeps, type InboundFailpoint, type InboundFailpoints } from '../src/ports.ts';

export const pool = new pg.Pool({ connectionString: localEnv().dbUrl, max: 8 });
export const db = new InboundDb(pool);

export async function q<R extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
  return (await pool.query<R>(sql, params)).rows;
}

export async function quietCron(): Promise<void> {
  await q(`update private.system_flags set enabled = false where key = 'cron_enabled'`);
}

export class FakeClock {
  t: Date;
  constructor(iso: string) {
    this.t = new Date(iso);
  }
  now = () => new Date(this.t.getTime());
  advanceMinutes(m: number) {
    this.t = new Date(this.t.getTime() + m * 60_000);
  }
}

export class FailpointCrash extends Error {
  constructor(point: string) {
    super(`failpoint ${point}`);
    this.name = 'FailpointCrash';
  }
}
export function crashAt(point: InboundFailpoint): InboundFailpoints {
  let fired = false;
  return {
    hit(name) {
      if (name === point && !fired) {
        fired = true;
        throw new FailpointCrash(name);
      }
    },
  };
}

/** A model output in the strict ReplyAnalysis shape. */
export const analysis = (intent: string, over: Record<string, unknown> = {}) => ({
  intent,
  confidence: 0.95,
  promisedDate: null,
  promisedDateText: null,
  dateIsVague: false,
  statedAmountText: null,
  language: 'en',
  summary: `classified as ${intent}`,
  ...over,
});

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
type Opt = string | undefined;
export function mail(o: { from: string; messageId: string; subject?: Opt; inReplyTo?: Opt; references?: Opt; date?: Opt; body: string; headers?: Opt; to?: Opt }): string {
  return crlf(
    [
      `From: ${o.from}`,
      `To: ${o.to ?? 'billing@test-co.example'}`,
      `Subject: ${o.subject ?? 'Re: Reminder'}`,
      `Message-ID: ${o.messageId}`,
      ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`] : []),
      ...(o.references ? [`References: ${o.references}`] : []),
      `Date: ${o.date ?? 'Tue, 20 Oct 2026 10:00:00 +0100'}`,
      ...(o.headers ? [o.headers.trimEnd()] : []),
      'Content-Type: text/plain; charset=utf-8',
      '',
      o.body,
      '',
    ].join('\n'),
  );
}

export interface ReplyInvoice {
  id: string;
  number: string;
  outboundId: string;
  rfcId: string;
}

export interface ReplyWorld {
  tenantId: string;
  customerId: string;
  invoices: ReplyInvoice[];
  emailAccountId: string;
  waAccountId: string;
  clock: FakeClock;
  classifier: FakeClassifier;
  /** text substring -> model output (or an Error for an outage). First match wins. */
  script: [string, unknown][];
  alerts: Alert[];
  deps: (over?: Partial<Omit<InboundDeps, 'config'>> & { config?: Partial<InboundConfig> }) => InboundDeps;
  /** Store a raw inbound email as the IMAP poller would. Returns the event id, or null when deduped. */
  email: (raw: string, providerEventId?: string) => Promise<number | null>;
  whatsapp: (kind: 'message' | 'status', item: Record<string, unknown>, providerEventId: string) => Promise<number | null>;
  run: (over?: Partial<Omit<InboundDeps, 'config'>> & { config?: Partial<InboundConfig> }) => Promise<InboundBatchResult>;
}

export interface ReplyWorldOptions {
  invoices?: number;
  statuses?: string[];
  promiseAcceptance?: 'auto' | 'review';
  clock?: string;
  phone?: string | null;
  cap?: number;
}

export async function replyWorld(o: ReplyWorldOptions = {}): Promise<ReplyWorld> {
  const tenantId = randomUUID();
  const suffix = tenantId.slice(0, 8);
  await q(
    `insert into public.tenants (id, name, timezone, currency, approval_mode, promise_acceptance, classification_daily_cap) values ($1, 'Test Co', 'Europe/London', 'GBP', 'never', $2, $3)`,
    [tenantId, o.promiseAcceptance ?? 'auto', o.cap ?? 500],
  );
  await q(`insert into public.policies (tenant_id, name, steps, escalate_after_days, grace_days_after_promise, max_messages_per_week, is_default)
           values ($1, 'P', '[{"id":"s1","daysAfterDue":1,"channel":"email","templateKey":"friendly"}]', 60, 2, 3, true)`, [tenantId]);
  const emailAccountId = randomUUID();
  const waAccountId = randomUUID();
  await q(`insert into public.channel_accounts (id, tenant_id, channel, config, external_account_id) values ($1, $2, 'email', $3, $4)`, [
    emailAccountId,
    tenantId,
    JSON.stringify({ from_address: 'billing@test-co.example', message_id_domain: 'test-co.example' }),
    `billing+${suffix}@test-co.example`,
  ]);
  await q(`insert into public.channel_accounts (id, tenant_id, channel, config, external_account_id) values ($1, $2, 'whatsapp', '{}', $3)`, [waAccountId, tenantId, `wa-${suffix}`]);
  const customerId = randomUUID();
  await q(`insert into public.customers (id, tenant_id, display_name, email, phone_e164, language) values ($1, $2, 'Ada Customer', 'ada@customer.example', $3, 'en')`, [
    customerId,
    tenantId,
    o.phone === undefined ? '+447700900123' : o.phone,
  ]);
  await q(`insert into public.customer_consents (tenant_id, customer_id, channel, granted_at, source) values ($1, $2, 'whatsapp', now(), 'test')`, [tenantId, customerId]);
  const invoices: ReplyInvoice[] = [];
  for (let i = 0; i < (o.invoices ?? 1); i++) {
    const id = randomUUID();
    const number = `T-${i + 1}`;
    await q(
      `insert into public.invoices (id, tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
       values ($1, $2, $3, $4, 125050, 'GBP', '2026-09-01', '2026-10-01', $5)`,
      [id, tenantId, customerId, number, `REF${randomUUID().replace(/-/g, '').slice(0, 9).toUpperCase()}`],
    );
    const status = o.statuses?.[i] ?? 'overdue';
    if (status !== 'open') await q('update public.invoices set status = $2 where id = $1', [id, status === 'paid' ? 'overdue' : status]);
    if (status === 'paid') {
      await q(`insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider_ref, paid_at) values ($1, $2, 125050, 'GBP', 'bank_transfer', $3, now())`, [tenantId, id, `P-${id}`]);
      await q(`update public.invoices set status = 'paid' where id = $1`, [id]);
    }
    const outboundId = randomUUID();
    const rfcId = `<${id}.s1.email.dueloop@test-co.example>`;
    await q(
      `insert into public.messages (id, tenant_id, customer_id, channel, direction, idempotency_key, send_state, step_id, rfc_message_id, provider_message_id, sent_at, pending_since)
       values ($1, $2, $3, 'email', 'out', $4, 'sent', 's1', $5, $5, '2026-10-19T09:00:00Z', '2026-10-19T09:00:00Z')`,
      [outboundId, tenantId, customerId, `${id}:s1:email`, rfcId],
    );
    await q('insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)', [tenantId, outboundId, id]);
    invoices.push({ id, number, outboundId, rfcId });
  }

  const clock = new FakeClock(o.clock ?? '2026-10-20T10:00:00Z');
  const script: [string, unknown][] = [];
  const classifier = new FakeClassifier((input: ClassifierInput) => {
    const hit = script.find(([needle]) => input.text.includes(needle));
    return hit ? hit[1] : analysis('unclear', { confidence: 0.9 });
  });
  const alerts: Alert[] = [];
  const deps: ReplyWorld['deps'] = (over = {}) => ({
    db,
    classifier,
    clock,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    notifier: { notify: async (a) => void alerts.push(a) },
    failpoints: NO_INBOUND_FAILPOINTS,
    ...over,
    config: { ...DEFAULT_INBOUND_CONFIG, ...over.config },
  });
  const store = async (account: string, provider: string, eventId: string, kind: string, payload: unknown, raw: string | null) =>
    (
      await q<{ id: string | null }>('select private.store_inbound_event($1, $2, $3, $4, $5, $6, $7) as id', [
        account,
        provider,
        eventId,
        kind,
        payload === null ? null : JSON.stringify(payload),
        raw,
        clock.now(),
      ])
    )[0]?.id ?? null;
  return {
    tenantId,
    customerId,
    invoices,
    emailAccountId,
    waAccountId,
    clock,
    classifier,
    script,
    alerts,
    deps,
    email: async (raw, providerEventId) => {
      const id = providerEventId ?? /Message-ID: (\S+)/i.exec(raw)?.[1] ?? randomUUID();
      const r = await store(emailAccountId, 'imap', id, 'message', null, raw);
      return r === null ? null : Number(r);
    },
    whatsapp: async (kind, item, providerEventId) => {
      const r = await store(waAccountId, 'whatsapp', providerEventId, kind, item, null);
      return r === null ? null : Number(r);
    },
    run: (over) => processInboundBatch(deps(over), { limit: 50, filter: { tenant_id: tenantId } }),
  };
}

export async function expireInboundVisibility(tenantId: string): Promise<void> {
  await q(`update pgmq.q_inbound_events set vt = now() - interval '1 second' where message ->> 'tenant_id' = $1`, [tenantId]);
}

export const invoiceRow = (id: string) =>
  q<{ status: string; promised_on: string | null; next_action_at: Date }>('select status, promised_on::text as promised_on, next_action_at from public.invoices where id = $1', [id]).then((r) => r[0]);
export const tasksOf = (tenantId: string) =>
  q<{ type: string; reason: string | null; invoice_id: string | null; blocks_reminders_until: Date | null; draft_reply: string | null; details: Record<string, unknown> }>(
    'select type, reason, invoice_id, blocks_reminders_until, draft_reply, details from public.tasks where tenant_id = $1 order by created_at, type',
    [tenantId],
  );
export const eventsOf = (tenantId: string, invoiceId: string) =>
  q<{ type: string }>('select type from public.invoice_events where tenant_id = $1 and invoice_id = $2 order by id', [tenantId, invoiceId]).then((r) => r.map((x) => x.type));
export const promisesOf = (tenantId: string) =>
  q<{ invoice_id: string; status: string; promised_on: string }>('select invoice_id, status, promised_on::text as promised_on from public.promises where tenant_id = $1 order by created_at', [tenantId]);
