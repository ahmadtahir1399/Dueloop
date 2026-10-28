// Database access for the inbound processor (direct connection as a trusted role, like the worker).
// applyPlan is the "supervisor": the one transaction that writes a reply's effects (pipeline step 9).
import type { Effect, InvoiceStatus, PlanTaskType, ReviewReason } from '@dueloop/core';
import type pg from 'pg';
import type { DeliveryStatus } from './types.ts';

export interface ClaimedEvent {
  readonly msgId: number;
  readonly readCount: number;
  readonly eventId: number;
  readonly tenantId: string;
}

export interface InboundEventRow {
  readonly id: number;
  readonly tenantId: string;
  readonly channelAccountId: string;
  readonly provider: 'whatsapp' | 'imap';
  readonly kind: 'message' | 'status';
  readonly payload: Record<string, unknown> | null;
  readonly rawMime: string | null;
  readonly receivedAt: Date;
  readonly status: 'pending' | 'processed' | 'dead';
  readonly attempts: number;
}

export interface TenantRow {
  readonly name: string;
  readonly timezone: string;
  readonly currency: string;
  readonly quietStartHour: number;
  readonly quietEndHour: number;
  readonly holidays: readonly string[];
  readonly promiseAcceptance: 'auto' | 'review';
  readonly classificationCap: number;
  /** Our own sending addresses (loop detection). */
  readonly ownAddresses: readonly string[];
}

export interface CustomerRow {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly optedOut: boolean;
}

export interface InvoiceRow {
  readonly id: string;
  readonly customerId: string;
  readonly status: InvoiceStatus;
  readonly balanceMinor: number;
  readonly currency: string;
  readonly number: string;
  readonly referenceCode: string;
}

export interface ThreadHit {
  readonly messageId: string;
  readonly invoiceIds: readonly string[];
  readonly sendState: string | null;
  readonly customerId: string | null;
}

/** A task the pipeline adds on its own (not from planReplyOutcome). */
export interface TaskSpec {
  readonly type: PlanTaskType | 'ambiguous_invoice' | 'unmatched_inbound' | 'unprocessed_inbound' | 'delivery_failed' | 'invalid_contact';
  readonly reason: ReviewReason | string | null;
  readonly invoiceId: string | null;
  readonly blocksRemindersDays: number;
  readonly draft: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ApplyRequest {
  readonly tenantId: string;
  readonly messageId: string;
  readonly customerId: string | null;
  readonly invoiceId: string | null;
  /** The status the plan was made against. Null when no invoice is involved. */
  readonly expectedStatus: InvoiceStatus | null;
  readonly reference: Date;
  readonly now: Date;
  readonly effects: readonly Effect[];
  readonly extraTasks: readonly TaskSpec[];
  readonly tenantEvents: readonly { readonly type: string; readonly key: string; readonly payload: Readonly<Record<string, unknown>> }[];
  /** Invoices the message is linked to (message_invoices). */
  readonly linkInvoiceIds: readonly string[];
  /** Drafts for planned tasks, by task type (code-written, never model text). */
  readonly drafts: Readonly<Partial<Record<PlanTaskType, string>>>;
  readonly messageFields: {
    /** 'pay_page_token': a prompt 6 pay/opt-out page action (a valid token proves possession of our message). */
    readonly matchedBy: 'thread' | 'context_id' | 'single_open_invoice' | 'none' | 'pay_page_token';
    readonly prefilter: string;
    readonly analysis: Readonly<Record<string, unknown>> | null;
    readonly modelId: string | null;
    readonly promptVersion: string | null;
    readonly latencyMs: number | null;
    readonly tokensIn: number | null;
    readonly tokensOut: number | null;
  };
}

export type ApplyResult = { readonly kind: 'applied'; readonly notify: readonly Effect[] } | { readonly kind: 'already_processed' } | { readonly kind: 'status_changed' };

const DAY = 86_400_000;

/** The invoice moved between planning and applying: the transaction rolls back and the caller re-plans. */
class StatusChanged extends Error {}
const RANK: Record<DeliveryStatus, number> = { sent: 1, delivered: 2, read: 3, failed: 9 };

/** Status rank (issue I): queued < sent < delivered < read; failed is terminal for that attempt. */
export function nextDeliveryStatus(current: DeliveryStatus | 'queued' | null, incoming: DeliveryStatus): DeliveryStatus | null {
  if (current === null || current === 'queued') return incoming;
  if (current === 'failed') return null;
  if (incoming === 'failed') return current === 'delivered' || current === 'read' ? null : 'failed';
  return RANK[incoming] > RANK[current] ? incoming : null;
}

const TRANSITION_EVENT: Partial<Record<string, string>> = { dispute_raised: 'DisputeRaised' };
const TASK_EVENT: Partial<Record<string, string>> = {
  verify_payment_claim: 'PaymentClaimReceived',
  review_promise: 'ReplyNeedsReview',
  human_review: 'ReplyNeedsReview',
  info_request: 'ReplyNeedsReview',
};

export class InboundDb {
  readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  // ---- queue -----------------------------------------------------------------------------------------
  async claim(n: number, vt: number, filter: Record<string, string> = {}): Promise<ClaimedEvent[]> {
    const r = await this.pool.query<{ msg_id: string; read_ct: number; event_id: string; tenant_id: string }>('select * from private.claim_inbound($1, $2, $3)', [n, vt, JSON.stringify(filter)]);
    return r.rows.map((x) => ({ msgId: Number(x.msg_id), readCount: x.read_ct, eventId: Number(x.event_id), tenantId: x.tenant_id }));
  }
  async ack(msgId: number): Promise<void> {
    await this.pool.query('select private.ack_inbound($1)', [msgId]);
  }
  async release(msgId: number, delaySeconds: number): Promise<void> {
    await this.pool.query('select private.release_inbound($1, $2)', [msgId, delaySeconds]);
  }

  // ---- raw events --------------------------------------------------------------------------------------
  async event(eventId: number): Promise<InboundEventRow | null> {
    const r = await this.pool.query<{
      id: string;
      tenant_id: string;
      channel_account_id: string;
      provider: 'whatsapp' | 'imap';
      kind: 'message' | 'status';
      payload: Record<string, unknown> | null;
      raw_mime: string | null;
      received_at: Date;
      status: 'pending' | 'processed' | 'dead';
      attempts: number;
    }>('select * from public.inbound_events where id = $1', [eventId]);
    const x = r.rows[0];
    return x
      ? { id: Number(x.id), tenantId: x.tenant_id, channelAccountId: x.channel_account_id, provider: x.provider, kind: x.kind, payload: x.payload, rawMime: x.raw_mime, receivedAt: x.received_at, status: x.status, attempts: x.attempts }
      : null;
  }
  async bumpAttempt(eventId: number, code: string): Promise<number> {
    const r = await this.pool.query<{ attempts: number }>('update public.inbound_events set attempts = attempts + 1, last_error = $2 where id = $1 returning attempts', [eventId, code.slice(0, 200)]);
    return r.rows[0]?.attempts ?? 0;
  }
  async markEventProcessed(eventId: number, at: Date): Promise<void> {
    await this.pool.query(`update public.inbound_events set status = 'processed', processed_at = $2 where id = $1 and status = 'pending'`, [eventId, at]);
  }

  /** After N failures: a dead letter (ids only) + a human task so the message is never silently lost. */
  async deadLetter(ev: InboundEventRow, reason: string, messageId: string | null, at: Date): Promise<void> {
    await this.tx(async (c) => {
      await c.query(`insert into public.dead_letters (tenant_id, source, reason, attempts, payload) values ($1, 'inbound_events', $2, $3, $4)`, [
        ev.tenantId,
        reason.slice(0, 200),
        ev.attempts,
        JSON.stringify({ eventId: ev.id }),
      ]);
      await c.query(
        `insert into public.tasks (tenant_id, type, reason, message_id, details, dedupe_key, created_at)
         values ($1, 'unprocessed_inbound', $2, $3, $4, $5, $6) on conflict (tenant_id, dedupe_key) do nothing`,
        [ev.tenantId, 'processing_failed', messageId, JSON.stringify({ eventId: ev.id }), `event:${ev.id}:unprocessed`, at],
      );
      await c.query(
        `insert into public.tenant_events (tenant_id, message_id, type, payload, idempotency_key) values ($1, $2, 'InboundDeadLettered', $3, $4)
         on conflict (tenant_id, idempotency_key) do nothing`,
        [ev.tenantId, messageId, JSON.stringify({ eventId: ev.id, reason: reason.slice(0, 60) }), `event:${ev.id}:dead`],
      );
      await c.query(`update public.inbound_events set status = 'dead', processed_at = $2 where id = $1`, [ev.id, at]);
    });
  }

  // ---- tenant, sender, invoices ------------------------------------------------------------------------
  async tenant(tenantId: string): Promise<TenantRow> {
    const r = await this.pool.query<{
      name: string;
      timezone: string;
      currency: string;
      quiet_start_hour: number;
      quiet_end_hour: number;
      promise_acceptance: 'auto' | 'review';
      classification_daily_cap: number;
      holidays: string[] | null;
      own: string[] | null;
    }>(
      `select t.name, t.timezone, t.currency, t.quiet_start_hour, t.quiet_end_hour, t.promise_acceptance, t.classification_daily_cap,
              (select array_agg(h.on_date::text) from public.holidays h where h.tenant_id = t.id) as holidays,
              (select array_agg(lower(ca.config ->> 'from_address')) from public.channel_accounts ca where ca.tenant_id = t.id and ca.config ? 'from_address') as own
       from public.tenants t where t.id = $1`,
      [tenantId],
    );
    const x = r.rows[0];
    if (!x) throw new Error('tenant not found');
    return {
      name: x.name,
      timezone: x.timezone,
      currency: x.currency,
      quietStartHour: x.quiet_start_hour,
      quietEndHour: x.quiet_end_hour,
      holidays: x.holidays ?? [],
      promiseAcceptance: x.promise_acceptance,
      classificationCap: x.classification_daily_cap,
      ownAddresses: x.own ?? [],
    };
  }

  async customerBy(tenantId: string, field: 'email' | 'phone_e164', value: string): Promise<CustomerRow | null> {
    const col = field === 'email' ? 'lower(email)' : 'phone_e164';
    const r = await this.pool.query<{ id: string; display_name: string; language: string; opted_out: boolean }>(
      `select id, display_name, language, opted_out from public.customers where tenant_id = $1 and ${col} = $2 order by created_at limit 2`,
      [tenantId, value],
    );
    // Two customers sharing a contact is ambiguous: treat the sender as unknown rather than guess (rule 24).
    const x = r.rows.length === 1 ? r.rows[0] : undefined;
    return x ? { id: x.id, name: x.display_name, language: x.language, optedOut: x.opted_out } : null;
  }

  async threadHits(tenantId: string, ids: readonly string[]): Promise<ThreadHit[]> {
    if (ids.length === 0) return [];
    const r = await this.pool.query<{ id: string; send_state: string | null; customer_id: string | null; invoice_ids: string[] | null }>(
      `select m.id, m.send_state, m.customer_id, array_remove(array_agg(mi.invoice_id), null) as invoice_ids
       from public.messages m left join public.message_invoices mi on mi.tenant_id = m.tenant_id and mi.message_id = m.id
       where m.tenant_id = $1 and m.direction = 'out' and (m.rfc_message_id = any($2) or m.provider_message_id = any($2))
       group by m.id`,
      [tenantId, ids],
    );
    return r.rows.map((x) => ({ messageId: x.id, sendState: x.send_state, customerId: x.customer_id, invoiceIds: x.invoice_ids ?? [] }));
  }

  async openInvoices(tenantId: string, customerId: string): Promise<{ invoiceId: string; number: string; status: string; lastOutboundAt: Date | null }[]> {
    const r = await this.pool.query<{ id: string; number: string; status: string; last_out: Date | null }>(
      `select i.id, i.number, i.status,
              (select max(coalesce(m.sent_at, m.created_at)) from public.message_invoices mi join public.messages m on m.tenant_id = mi.tenant_id and m.id = mi.message_id
               where mi.tenant_id = i.tenant_id and mi.invoice_id = i.id and m.direction = 'out' and m.send_state in ('sent', 'unknown')) as last_out
       from public.invoices i where i.tenant_id = $1 and i.customer_id = $2 and i.status not in ('paid', 'written_off', 'cancelled')
       order by i.number`,
      [tenantId, customerId],
    );
    return r.rows.map((x) => ({ invoiceId: x.id, number: x.number, status: x.status, lastOutboundAt: x.last_out }));
  }

  async invoice(tenantId: string, invoiceId: string): Promise<InvoiceRow | null> {
    const r = await this.pool.query<{ id: string; customer_id: string; status: InvoiceStatus; balance: string; currency: string; number: string; reference_code: string }>(
      `select i.id, i.customer_id, i.status, b.balance::text as balance, i.currency, i.number, i.reference_code
       from public.invoices i join public.invoice_balances b on b.tenant_id = i.tenant_id and b.invoice_id = i.id
       where i.tenant_id = $1 and i.id = $2`,
      [tenantId, invoiceId],
    );
    const x = r.rows[0];
    return x ? { id: x.id, customerId: x.customer_id, status: x.status, balanceMinor: Number(x.balance), currency: x.currency, number: x.number, referenceCode: x.reference_code } : null;
  }

  async activePromise(tenantId: string, invoiceId: string): Promise<{ id: string; promisedOn: string; referenceAt: Date } | null> {
    const r = await this.pool.query<{ id: string; promised_on: string; reference_at: Date }>(
      `select id, promised_on::text as promised_on, reference_at from public.promises where tenant_id = $1 and invoice_id = $2 and status = 'active'`,
      [tenantId, invoiceId],
    );
    const x = r.rows[0];
    return x ? { id: x.id, promisedOn: x.promised_on, referenceAt: x.reference_at } : null;
  }

  /** Promises already made on this invoice that did not hold (issue G renewal cap). */
  async renewalCount(tenantId: string, invoiceId: string): Promise<number> {
    const r = await this.pool.query<{ n: number }>(`select count(*)::int as n from public.promises where tenant_id = $1 and invoice_id = $2 and status in ('broken', 'superseded')`, [tenantId, invoiceId]);
    return r.rows[0]?.n ?? 0;
  }

  async classificationsSince(tenantId: string, since: Date): Promise<number> {
    const r = await this.pool.query<{ n: number }>(`select count(*)::int as n from public.messages where tenant_id = $1 and direction = 'in' and model_id is not null and received_at >= $2`, [tenantId, since]);
    return r.rows[0]?.n ?? 0;
  }

  // ---- messages -------------------------------------------------------------------------------------------
  /** Step 5: store once per (tenant, channel, provider id). Returns the row and whether it was processed already. */
  async storeInbound(m: {
    tenantId: string;
    eventId: number;
    channel: 'email' | 'whatsapp';
    providerMessageId: string;
    customerId: string | null;
    senderRef: string;
    body: string;
    newText: string;
    subject: string | null;
    inReplyTo: string | null;
    references: readonly string[];
    providerTimestamp: Date | null;
    receivedAt: Date;
    attachments: readonly unknown[];
  }): Promise<{ id: string; processedAt: Date | null; created: boolean }> {
    const ins = await this.pool.query<{ id: string }>(
      `insert into public.messages (tenant_id, customer_id, channel, direction, body, subject, provider_message_id, sender_ref, body_new_text,
                                    in_reply_to, thread_refs, provider_timestamp, received_at, attachments, inbound_event_id)
       values ($1, $2, $3, 'in', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (tenant_id, channel, provider_message_id) do nothing returning id`,
      [
        m.tenantId,
        m.customerId,
        m.channel,
        m.body.slice(0, 100_000),
        m.subject?.slice(0, 200) ?? null,
        m.providerMessageId,
        m.senderRef.slice(0, 320),
        m.newText.slice(0, 20_000),
        m.inReplyTo,
        m.references.slice(0, 50),
        m.providerTimestamp,
        m.receivedAt,
        JSON.stringify(m.attachments.slice(0, 50)),
        m.eventId,
      ],
    );
    if (ins.rows[0]) return { id: ins.rows[0].id, processedAt: null, created: true };
    const ex = await this.pool.query<{ id: string; processed_at: Date | null }>(
      'select id, processed_at from public.messages where tenant_id = $1 and channel = $2 and provider_message_id = $3',
      [m.tenantId, m.channel, m.providerMessageId],
    );
    const x = ex.rows[0];
    if (!x) throw new Error('inbound message vanished');
    return { id: x.id, processedAt: x.processed_at, created: false };
  }

  /** Step 9, the supervisor: every effect of one reply, exactly once, in ONE transaction. */
  async applyPlan(a: ApplyRequest): Promise<ApplyResult> {
    try {
      return await this.applyPlanTx(a);
    } catch (e) {
      if (e instanceof StatusChanged) return { kind: 'status_changed' };
      throw e;
    }
  }

  private async applyPlanTx(a: ApplyRequest): Promise<ApplyResult> {
    return this.tx(async (c) => {
      const msg = await c.query<{ processed_at: Date | null }>('select processed_at from public.messages where tenant_id = $1 and id = $2 for update', [a.tenantId, a.messageId]);
      if (!msg.rows[0]) throw new Error('message not found');
      if (msg.rows[0].processed_at) return { kind: 'already_processed' as const };
      if (a.invoiceId && a.expectedStatus) {
        const inv = await c.query<{ status: string }>('select status from public.invoices where tenant_id = $1 and id = $2 for update', [a.tenantId, a.invoiceId]);
        if (inv.rows[0]?.status !== a.expectedStatus) throw new StatusChanged();
      }
      const event = async (invoiceId: string, type: string, key: string, payload: Record<string, unknown>) =>
        c.query(
          `insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at) values ($1, $2, $3, $4, $5, $6)
           on conflict (tenant_id, idempotency_key) do nothing`,
          [a.tenantId, invoiceId, type, JSON.stringify(payload), key, a.now],
        );
      const tenantEvent = async (type: string, key: string, payload: Readonly<Record<string, unknown>>) =>
        c.query(
          `insert into public.tenant_events (tenant_id, customer_id, message_id, type, payload, idempotency_key, created_at) values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (tenant_id, idempotency_key) do nothing`,
          [a.tenantId, a.customerId, a.messageId, type, JSON.stringify(payload), key, a.now],
        );
      const task = async (t: TaskSpec) => {
        const until = t.blocksRemindersDays > 0 ? new Date(a.now.getTime() + t.blocksRemindersDays * DAY) : null;
        await c.query(
          `insert into public.tasks (tenant_id, type, reason, invoice_id, customer_id, message_id, details, draft_reply, blocks_reminders_until, dedupe_key, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (tenant_id, dedupe_key) do nothing`,
          [a.tenantId, t.type, t.reason, t.invoiceId, a.customerId, a.messageId, JSON.stringify(t.details), t.draft, until, `${a.messageId}:${t.type}`, a.now],
        );
        if (t.invoiceId && TASK_EVENT[t.type]) await event(t.invoiceId, TASK_EVENT[t.type] ?? '', `${a.messageId}:${t.type}`, { reason: t.reason });
        if (t.invoiceId && until) {
          await event(t.invoiceId, 'RemindersBlocked', `${a.messageId}:${t.type}:blocked`, { until: until.toISOString(), taskType: t.type });
          await c.query('update public.invoices set next_action_at = greatest(next_action_at, $3) where tenant_id = $1 and id = $2', [a.tenantId, t.invoiceId, until]);
        }
      };
      const notify: Effect[] = [];

      for (const e of a.effects) {
        switch (e.kind) {
          case 'transition': {
            if (!a.invoiceId) break;
            // The state machine in the DB (0002 trigger) rejects anything illegal; the guard above pinned `from`.
            await c.query('update public.invoices set status = $3 where tenant_id = $1 and id = $2 and status = $4', [a.tenantId, a.invoiceId, e.to, e.from]);
            const type = TRANSITION_EVENT[e.event];
            if (type) await event(a.invoiceId, type, `${a.messageId}:${e.event}`, { from: e.from, to: e.to });
            break;
          }
          case 'set_promise': {
            if (!a.invoiceId || !a.customerId) break;
            const active = await c.query<{ id: string; reference_at: Date }>(
              `select id, reference_at from public.promises where tenant_id = $1 and invoice_id = $2 and status = 'active' for update`,
              [a.tenantId, a.invoiceId],
            );
            const prev = active.rows[0];
            // A late-processed OLDER message never supersedes a newer promise (issue G).
            if (prev && prev.reference_at.getTime() > a.reference.getTime()) break;
            const ins = await c.query<{ id: string }>(
              `insert into public.promises (tenant_id, invoice_id, customer_id, source_message_id, promised_on, reference_at, created_at)
               values ($1, $2, $3, $4, $5, $6, $7) on conflict (tenant_id, source_message_id) do nothing returning id`,
              [a.tenantId, a.invoiceId, a.customerId, a.messageId, e.promisedOn, a.reference, a.now],
            );
            if (prev && ins.rows[0]) {
              await c.query(`update public.promises set status = 'superseded', resolved_at = $3, resolved_by = 'reply', superseded_by = $4 where tenant_id = $1 and id = $2`, [
                a.tenantId,
                prev.id,
                a.now,
                ins.rows[0].id,
              ]);
              await event(a.invoiceId, 'PromiseSuperseded', `promise:${prev.id}:superseded`, { promiseId: prev.id, by: ins.rows[0].id });
            }
            await c.query('update public.invoices set promised_on = $3 where tenant_id = $1 and id = $2', [a.tenantId, a.invoiceId, e.promisedOn]);
            await event(a.invoiceId, 'PromiseRecorded', `${a.messageId}:promise`, { promisedOn: e.promisedOn });
            break;
          }
          case 'create_task':
            await task({ type: e.type, reason: e.reason, invoiceId: a.invoiceId, blocksRemindersDays: e.blocksRemindersDays, draft: a.drafts[e.type] ?? null, details: {} });
            break;
          case 'record_opt_out': {
            if (!a.customerId) break;
            await c.query('update public.customers set opted_out = true where tenant_id = $1 and id = $2', [a.tenantId, a.customerId]);
            // Conservative scope (DECISIONS NEEDED): every channel's consent is revoked.
            // greatest(): a consent recorded "in the future" relative to our clock (skew) is still revoked validly.
            await c.query('update public.customer_consents set revoked_at = greatest($3, granted_at) where tenant_id = $1 and customer_id = $2 and revoked_at is null', [a.tenantId, a.customerId, a.now]);
            await tenantEvent('OptOutRecorded', `${a.messageId}:optout`, { channel: 'all' });
            // Issue H: every non-final invoice's timeline explains why reminders stopped.
            const open = await c.query<{ id: string }>(`select id from public.invoices where tenant_id = $1 and customer_id = $2 and status not in ('paid', 'written_off', 'cancelled')`, [
              a.tenantId,
              a.customerId,
            ]);
            for (const inv of open.rows) await event(inv.id, 'OptOutRecorded', `${a.messageId}:optout:${inv.id}`, { source: 'reply' });
            break;
          }
          case 'notify':
            notify.push(e);
            break;
        }
      }
      for (const t of a.extraTasks) await task(t);
      for (const te of a.tenantEvents) await tenantEvent(te.type, te.key, te.payload);
      for (const id of a.linkInvoiceIds) {
        await c.query('insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3) on conflict do nothing', [a.tenantId, a.messageId, id]);
        await event(id, 'ReplyReceived', `${a.messageId}:received:${id}`, { matchedBy: a.messageFields.matchedBy, prefilter: a.messageFields.prefilter });
      }
      const f = a.messageFields;
      await c.query(
        `update public.messages set processed_at = $3, matched_by = $4, prefilter = $5, analysis = $6, model_id = $7, prompt_version = $8,
                classify_latency_ms = $9, tokens_in = $10, tokens_out = $11, customer_id = coalesce(customer_id, $12)
         where tenant_id = $1 and id = $2`,
        [a.tenantId, a.messageId, a.now, f.matchedBy, f.prefilter, f.analysis ? JSON.stringify(f.analysis) : null, f.modelId, f.promptVersion, f.latencyMs, f.tokensIn, f.tokensOut, a.customerId],
      );
      return { kind: 'applied' as const, notify };
    });
  }

  // ---- delivery status, bounces, unknown evidence ---------------------------------------------------------
  /** WhatsApp status (issue I): monotonic; a late 'sent' never downgrades 'delivered'. */
  async applyStatus(tenantId: string, wamid: string, status: DeliveryStatus, at: Date | null): Promise<{ messageId: string; invoiceIds: string[]; changed: boolean; customerId: string | null } | null> {
    return this.tx(async (c) => {
      // Lock the row first (FOR UPDATE cannot be combined with GROUP BY), then read its invoices.
      const r = await c.query<{ id: string; delivery_status: DeliveryStatus | 'queued' | null; customer_id: string | null }>(
        `select id, delivery_status, customer_id from public.messages
         where tenant_id = $1 and channel = 'whatsapp' and direction = 'out' and provider_message_id = $2 for update`,
        [tenantId, wamid],
      );
      const row = r.rows[0];
      if (!row) return null;
      const links = await c.query<{ invoice_id: string }>('select invoice_id from public.message_invoices where tenant_id = $1 and message_id = $2', [tenantId, row.id]);
      const m = { ...row, invoice_ids: links.rows.map((x) => x.invoice_id) };
      const next = nextDeliveryStatus(m.delivery_status, status);
      if (next) await c.query('update public.messages set delivery_status = $2, delivery_status_at = $3 where id = $1', [m.id, next, at]);
      return { messageId: m.id, invoiceIds: m.invoice_ids ?? [], changed: next !== null, customerId: m.customer_id };
    });
  }

  /** A hard delivery failure: event + task + (caller) alert. No fallback channel (DECISIONS NEEDED). */
  async recordDeliveryFailure(a: { tenantId: string; outboundMessageId: string; invoiceIds: readonly string[]; customerId: string | null; sourceMessageId: string | null; reason: string; invalidContact: boolean; at: Date }): Promise<void> {
    await this.tx(async (c) => {
      await c.query(`update public.messages set delivery_status = 'failed', delivery_status_at = $2 where id = $1`, [a.outboundMessageId, a.at]);
      for (const inv of a.invoiceIds) {
        await c.query(
          `insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at) values ($1, $2, 'DeliveryFailed', $3, $4, $5)
           on conflict (tenant_id, idempotency_key) do nothing`,
          [a.tenantId, inv, JSON.stringify({ messageId: a.outboundMessageId, reason: a.reason }), `${a.outboundMessageId}:delivery_failed:${inv}`, a.at],
        );
      }
      await c.query(
        `insert into public.tasks (tenant_id, type, reason, invoice_id, customer_id, message_id, details, dedupe_key, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (tenant_id, dedupe_key) do nothing`,
        [
          a.tenantId,
          a.invalidContact ? 'invalid_contact' : 'delivery_failed',
          a.reason.replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 60),
          a.invoiceIds[0] ?? null,
          a.customerId,
          a.sourceMessageId,
          JSON.stringify({ outboundMessageId: a.outboundMessageId }),
          `${a.outboundMessageId}:delivery_failed`,
          a.at,
        ],
      );
      await c.query(
        `insert into public.tenant_events (tenant_id, customer_id, message_id, type, payload, idempotency_key, created_at) values ($1, $2, $3, 'DeliveryFailed', $4, $5, $6)
         on conflict (tenant_id, idempotency_key) do nothing`,
        [a.tenantId, a.customerId, a.sourceMessageId, JSON.stringify({ outboundMessageId: a.outboundMessageId, reason: a.reason }), `${a.outboundMessageId}:delivery_failed`, a.at],
      );
    });
  }

  /**
   * Issue M: a reply or bounce threading to OUR Message-ID is evidence the message was sent. unknown -> sent with
   * an event; nothing is sent (rule 17 holds). Mirrors the worker's resolveUnknown(..., 'sent').
   */
  async resolveUnknownAsSent(outboundMessageId: string, nextActionAt: Date, evidence: string): Promise<boolean> {
    return this.tx(async (c) => {
      const m = await c.query<{ tenant_id: string; idempotency_key: string; step_id: string; channel: string; invoice_id: string }>(
        `select m.tenant_id, m.idempotency_key, m.step_id, m.channel, mi.invoice_id from public.messages m
         join public.message_invoices mi on mi.tenant_id = m.tenant_id and mi.message_id = m.id
         where m.id = $1 and m.send_state = 'unknown' for update of m`,
        [outboundMessageId],
      );
      const row = m.rows[0];
      if (!row) return false;
      await c.query(`update public.messages set send_state = 'sent', sent_at = coalesce(sent_at, pending_since) where id = $1`, [outboundMessageId]);
      const ev = (type: string, key: string, payload: Record<string, unknown>) =>
        c.query(
          `insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key) values ($1, $2, $3, $4, $5) on conflict (tenant_id, idempotency_key) do nothing`,
          [row.tenant_id, row.invoice_id, type, JSON.stringify(payload), key],
        );
      await ev('ReminderSent', `${row.idempotency_key}:sent`, { stepId: row.step_id, channel: row.channel, reconciled: true });
      await ev('MessageReconciled', `${row.idempotency_key}:reconciled-sent`, { as: 'sent', evidence });
      await c.query(
        `update public.invoices set next_action_at = $3, parked_reason = null, enqueued_at = null where tenant_id = $1 and id = $2 and parked_reason in ('message_unknown', 'send_ambiguous')`,
        [row.tenant_id, row.invoice_id, nextActionAt],
      );
      return true;
    });
  }

  async firstNotification(tenantId: string, dedupeKey: string, period: string, kind: string, at: Date): Promise<boolean> {
    const r = await this.pool.query(
      `insert into public.notifications (tenant_id, dedupe_key, period, kind, created_at) values ($1, $2, $3, $4, $5) on conflict (tenant_id, dedupe_key, period) do nothing`,
      [tenantId, dedupeKey.slice(0, 200), period, kind, at],
    );
    return (r.rowCount ?? 0) === 1;
  }
}
