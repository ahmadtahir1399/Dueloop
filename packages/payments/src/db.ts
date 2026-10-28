// Database access for the payment pipeline (trusted direct connection). All ledger writes go through
// private.apply_payment, which validates the plan under the invoice row lock.
import type { InvoiceStatus, PaymentEvent, PaymentPlan } from '@dueloop/core';
import type pg from 'pg';

export interface ClaimedPaymentEvent {
  readonly msgId: number;
  readonly readCount: number;
  readonly eventId: number;
  readonly tenantId: string;
}

export interface PaymentEventRow {
  readonly id: number;
  readonly tenantId: string;
  readonly accountId: string | null;
  readonly provider: string;
  readonly providerEventId: string;
  readonly kind: PaymentEvent['type'];
  readonly event: PaymentEvent;
  readonly status: 'pending' | 'processed' | 'dead';
  readonly attempts: number;
}

export interface RequestRow {
  readonly id: string;
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly accountId: string | null;
  readonly provider: string;
  readonly providerObjectId: string | null;
  readonly url: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: string;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
}

export interface InvoiceForPayment {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly number: string;
  readonly status: InvoiceStatus;
  readonly balanceMinor: number;
  readonly currency: string;
  readonly referenceCode: string;
  readonly timezone: string;
  readonly graceDays: number;
  readonly promisedOn: string | null;
}

export interface ReceiptInput {
  readonly method: 'bank_transfer' | 'stripe' | 'fake';
  readonly source: 'gateway' | 'poll' | 'manual' | 'proof';
  readonly providerRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly receivedAt: Date;
  readonly confirmedBy: string | null;
  readonly paymentEventId: number | null;
  readonly proofId: string | null;
  readonly note: string | null;
}

/** Optional narrowing for sweeps and polls (one tenant, one invoice). */
export interface Scope {
  readonly tenantId?: string;
  readonly invoiceId?: string;
}

export type ApplyResult = { readonly result: 'applied' | 'duplicate'; readonly receiptId: string } | { readonly result: 'replan' };

const DATE_ONLY = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : typeof d === 'string' ? d : null);

export class PaymentsDb {
  readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  // ---- queue -------------------------------------------------------------------------------------------
  async claim(n: number, vt: number, filter: Record<string, string> = {}): Promise<ClaimedPaymentEvent[]> {
    const r = await this.pool.query<{ msg_id: string; read_ct: number; message: { event_id: number; tenant_id: string } }>('select msg_id, read_ct, message from pgmq.read($1::text, $2::integer, $3::integer, $4::jsonb)', [
      'payment_events',
      vt,
      n,
      JSON.stringify(filter),
    ]);
    return r.rows.map((x) => ({ msgId: Number(x.msg_id), readCount: x.read_ct, eventId: Number(x.message.event_id), tenantId: x.message.tenant_id }));
  }
  async ack(msgId: number): Promise<void> {
    await this.pool.query(`select pgmq.archive('payment_events', $1::bigint)`, [msgId]);
  }
  async release(msgId: number, delay: number): Promise<void> {
    await this.pool.query(`select pgmq.set_vt('payment_events', $1::bigint, $2::integer)`, [msgId, delay]);
  }

  // ---- events ------------------------------------------------------------------------------------------
  async store(accountId: string, provider: string, e: PaymentEvent & { providerEventId: string }, raw: Record<string, unknown> | null, receivedAt: Date): Promise<number | null> {
    const r = await this.pool.query<{ id: string | null }>('select private.store_payment_event($1, $2, $3, $4, $5, $6, $7) as id', [
      accountId,
      provider,
      e.providerEventId.slice(0, 300),
      e.type,
      JSON.stringify(e),
      raw === null ? null : JSON.stringify(raw),
      receivedAt,
    ]);
    const id = r.rows[0]?.id ?? null;
    return id === null ? null : Number(id);
  }
  async event(id: number): Promise<PaymentEventRow | null> {
    const r = await this.pool.query<{ id: string; tenant_id: string; payment_account_id: string | null; provider: string; provider_event_id: string; kind: PaymentEvent['type']; event: Record<string, unknown>; status: 'pending' | 'processed' | 'dead'; attempts: number }>(
      'select id, tenant_id, payment_account_id, provider, provider_event_id, kind, event, status, attempts from public.payment_events where id = $1',
      [id],
    );
    const x = r.rows[0];
    if (!x) return null;
    // Dates come back from jsonb as strings.
    const e = { ...x.event } as Record<string, unknown>;
    for (const k of ['paidAt', 'at']) if (typeof e[k] === 'string') e[k] = new Date(e[k] as string);
    return { id: Number(x.id), tenantId: x.tenant_id, accountId: x.payment_account_id, provider: x.provider, providerEventId: x.provider_event_id, kind: x.kind, event: e as unknown as PaymentEvent, status: x.status, attempts: x.attempts };
  }
  async bumpAttempt(id: number, code: string): Promise<number> {
    const r = await this.pool.query<{ attempts: number }>('update public.payment_events set attempts = attempts + 1, last_error = $2 where id = $1 returning attempts', [id, code.slice(0, 200)]);
    return r.rows[0]?.attempts ?? 0;
  }
  async markProcessed(id: number, at: Date): Promise<void> {
    await this.pool.query(`update public.payment_events set status = 'processed', processed_at = $2 where id = $1 and status = 'pending'`, [id, at]);
  }
  async deadLetter(ev: PaymentEventRow, reason: string, at: Date): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into public.dead_letters (tenant_id, source, reason, attempts, payload) values ($1, 'payment_events', $2, $3, $4)`, [ev.tenantId, reason.slice(0, 200), ev.attempts, JSON.stringify({ eventId: ev.id })]);
      await c.query(
        `insert into public.tasks (tenant_id, type, reason, urgent, details, dedupe_key, created_at) values ($1, 'unprocessed_payment_event', 'processing_failed', true, $2, $3, $4)
         on conflict (tenant_id, dedupe_key) do nothing`,
        [ev.tenantId, JSON.stringify({ eventId: ev.id }), `payment-event:${ev.id}:unprocessed`, at],
      );
      await c.query(
        `insert into public.tenant_events (tenant_id, type, payload, idempotency_key, created_at) values ($1, 'PaymentEventDeadLettered', $2, $3, $4) on conflict (tenant_id, idempotency_key) do nothing`,
        [ev.tenantId, JSON.stringify({ eventId: ev.id }), `payment-event:${ev.id}:dead`, at],
      );
      await c.query(`update public.payment_events set status = 'dead', processed_at = $2 where id = $1`, [ev.id, at]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  // ---- accounts, requests, invoices --------------------------------------------------------------------
  async accountByTokenHash(hash: string): Promise<{ id: string; tenantId: string; provider: string; mode: 'test' | 'live' } | null> {
    const r = await this.pool.query<{ id: string; tenant_id: string; provider: string; mode: 'test' | 'live' }>('select id, tenant_id, provider, mode from public.payment_accounts where webhook_token_hash = $1 and enabled', [hash]);
    const x = r.rows[0];
    return x ? { id: x.id, tenantId: x.tenant_id, provider: x.provider, mode: x.mode } : null;
  }
  async account(id: string): Promise<{ id: string; tenantId: string; provider: string; mode: 'test' | 'live' } | null> {
    const r = await this.pool.query<{ id: string; tenant_id: string; provider: string; mode: 'test' | 'live' }>('select id, tenant_id, provider, mode from public.payment_accounts where id = $1', [id]);
    const x = r.rows[0];
    return x ? { id: x.id, tenantId: x.tenant_id, provider: x.provider, mode: x.mode } : null;
  }
  async accountFor(tenantId: string): Promise<{ id: string; provider: string; mode: 'test' | 'live' } | null> {
    const r = await this.pool.query<{ id: string; provider: string; mode: 'test' | 'live' }>('select id, provider, mode from public.payment_accounts where tenant_id = $1 and enabled order by created_at limit 1', [tenantId]);
    return r.rows[0] ?? null;
  }
  async secret(accountId: string, kind: 'api_key' | 'webhook_secret'): Promise<string | null> {
    const r = await this.pool.query<{ s: string | null }>('select private.payment_secret($1, $2) as s', [accountId, kind]);
    return r.rows[0]?.s ?? null;
  }

  private static request(x: Record<string, unknown>): RequestRow {
    return {
      id: String(x.id),
      tenantId: String(x.tenant_id),
      invoiceId: String(x.invoice_id),
      accountId: (x.payment_account_id as string | null) ?? null,
      provider: String(x.provider),
      providerObjectId: (x.provider_object_id as string | null) ?? null,
      url: (x.url as string | null) ?? null,
      amountMinor: Number(x.amount),
      currency: String(x.currency),
      status: String(x.status),
      expiresAt: (x.expires_at as Date | null) ?? null,
      createdAt: x.created_at as Date,
    };
  }
  /** Issue G: the ONLY way an event finds its tenant and invoice. */
  async requestByObject(provider: string, objectId: string): Promise<RequestRow | null> {
    const r = await this.pool.query('select * from public.payment_requests where provider = $1 and provider_object_id = $2', [provider, objectId]);
    return r.rows[0] ? PaymentsDb.request(r.rows[0]) : null;
  }
  async activeRequest(tenantId: string, invoiceId: string, provider: string): Promise<RequestRow | null> {
    const r = await this.pool.query(`select * from public.payment_requests where tenant_id = $1 and invoice_id = $2 and provider = $3 and status = 'active'`, [tenantId, invoiceId, provider]);
    return r.rows[0] ? PaymentsDb.request(r.rows[0]) : null;
  }
  async insertRequest(r: Omit<RequestRow, 'status'> & { idempotencyKey: string }): Promise<RequestRow> {
    const ins = await this.pool.query(
      `insert into public.payment_requests (id, tenant_id, invoice_id, payment_account_id, provider, provider_object_id, url, amount, currency, expires_at, idempotency_key, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (tenant_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key returning *`,
      [r.id, r.tenantId, r.invoiceId, r.accountId, r.provider, r.providerObjectId, r.url, r.amountMinor, r.currency, r.expiresAt, r.idempotencyKey, r.createdAt],
    );
    await this.pool.query(
      `insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at) values ($1, $2, 'PaymentRequestCreated', $3, $4, $5)
       on conflict (tenant_id, idempotency_key) do nothing`,
      [r.tenantId, r.invoiceId, JSON.stringify({ requestId: ins.rows[0]?.id, provider: r.provider, amount: r.amountMinor, currency: r.currency }), `request:${ins.rows[0]?.id}:created`, r.createdAt],
    );
    return PaymentsDb.request(ins.rows[0] as Record<string, unknown>);
  }
  async deactivateRequest(id: string, reason: string, at: Date): Promise<boolean> {
    const r = await this.pool.query<{ tenant_id: string; invoice_id: string }>(
      `update public.payment_requests set status = 'deactivated', deactivated_at = $3, deactivation_reason = $2,
              provider_deactivated_at = case when provider_object_id is null then $3 else provider_deactivated_at end
       where id = $1 and status = 'active' returning tenant_id, invoice_id`,
      [id, reason, at],
    );
    const x = r.rows[0];
    if (x) {
      await this.pool.query(
        `insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at) values ($1, $2, 'PaymentRequestDeactivated', $3, $4, $5)
         on conflict (tenant_id, idempotency_key) do nothing`,
        [x.tenant_id, x.invoice_id, JSON.stringify({ requestId: id, reason }), `request:${id}:deactivated`, at],
      );
    }
    return x !== undefined;
  }
  /** Active requests on final invoices (paid elsewhere, cancelled, written off): to deactivate. */
  async staleActiveRequests(limit: number, scope: Scope = {}): Promise<RequestRow[]> {
    const r = await this.pool.query(
      `select q.* from public.payment_requests q join public.invoices i on i.tenant_id = q.tenant_id and i.id = q.invoice_id
       where q.status = 'active' and i.status in ('paid', 'written_off', 'cancelled')
         and ($2::uuid is null or q.tenant_id = $2) and ($3::uuid is null or q.invoice_id = $3) limit $1`,
      [limit, scope.tenantId ?? null, scope.invoiceId ?? null],
    );
    return r.rows.map((x) => PaymentsDb.request(x));
  }
  /** Rows retired in OUR ledger whose hosted object may still accept money (issue F, migration 0013). */
  async requestsToSync(limit: number, scope: Scope = {}): Promise<RequestRow[]> {
    const r = await this.pool.query(
      `select * from public.payment_requests where status <> 'active' and provider_object_id is not null and provider_deactivated_at is null
         and ($2::uuid is null or tenant_id = $2) and ($3::uuid is null or invoice_id = $3) order by deactivated_at limit $1`,
      [limit, scope.tenantId ?? null, scope.invoiceId ?? null],
    );
    return r.rows.map((x) => PaymentsDb.request(x));
  }
  async markProviderDeactivated(id: string, at: Date): Promise<void> {
    await this.pool.query('update public.payment_requests set provider_deactivated_at = $2 where id = $1 and provider_deactivated_at is null', [id, at]);
  }
  /** How many requests this invoice already had with this provider: makes the next idempotency key stable on retry. */
  async requestGeneration(tenantId: string, invoiceId: string, provider: string): Promise<number> {
    const r = await this.pool.query<{ n: number }>(`select count(*)::int as n from public.payment_requests where tenant_id = $1 and invoice_id = $2 and provider = $3 and status <> 'active'`, [tenantId, invoiceId, provider]);
    return r.rows[0]?.n ?? 0;
  }
  async pendingRequests(olderThan: Date, limit: number, scope: Scope = {}): Promise<RequestRow[]> {
    const r = await this.pool.query(
      `select * from public.payment_requests where status = 'active' and provider_object_id is not null and created_at < $1
         and ($3::uuid is null or tenant_id = $3) order by created_at limit $2`,
      [olderThan, limit, scope.tenantId ?? null],
    );
    return r.rows.map((x) => PaymentsDb.request(x));
  }

  /** A member of this tenant by user id or email (the confirming human, rule 27). */
  async member(tenantId: string, ref: string): Promise<{ userId: string; role: string } | null> {
    const r = await this.pool.query<{ user_id: string; role: string }>(
      `select m.user_id, m.role from public.memberships m join auth.users u on u.id = m.user_id
       where m.tenant_id = $1 and (m.user_id::text = $2 or lower(u.email) = lower($2))`,
      [tenantId, ref],
    );
    return r.rows.length === 1 && r.rows[0] ? { userId: r.rows[0].user_id, role: r.rows[0].role } : null;
  }
  async invoiceIdByRef(tenantId: string, ref: string): Promise<string | null> {
    const r = await this.pool.query<{ id: string }>('select id from public.invoices where tenant_id = $1 and (id::text = $2 or number = $2)', [tenantId, ref]);
    return r.rows.length === 1 ? (r.rows[0]?.id ?? null) : null;
  }
  async invoice(tenantId: string, invoiceId: string): Promise<InvoiceForPayment | null> {
    const r = await this.pool.query<Record<string, unknown>>(
      `select i.id, i.tenant_id, i.customer_id, i.number, i.status, b.balance, i.currency, i.reference_code, t.timezone,
              coalesce((select p.grace_days_after_promise from public.policies p where p.tenant_id = i.tenant_id and (p.id = i.policy_id or (i.policy_id is null and p.is_default)) order by (p.id = i.policy_id) desc limit 1), 0) as grace,
              (select pr.promised_on::text from public.promises pr where pr.tenant_id = i.tenant_id and pr.invoice_id = i.id and pr.status = 'active') as promised_on
       from public.invoices i join public.invoice_balances b on b.tenant_id = i.tenant_id and b.invoice_id = i.id join public.tenants t on t.id = i.tenant_id
       where i.tenant_id = $1 and i.id = $2`,
      [tenantId, invoiceId],
    );
    const x = r.rows[0];
    if (!x) return null;
    return {
      id: String(x.id),
      tenantId: String(x.tenant_id),
      customerId: String(x.customer_id),
      number: String(x.number),
      status: x.status as InvoiceStatus,
      balanceMinor: Number(x.balance),
      currency: String(x.currency),
      referenceCode: String(x.reference_code),
      timezone: String(x.timezone),
      graceDays: Number(x.grace),
      promisedOn: DATE_ONLY(x.promised_on),
    };
  }

  /** Pipeline step 5: the single ledger write (private.apply_payment). */
  async apply(a: { invoice: InvoiceForPayment; receipt: ReceiptInput; plan: PaymentPlan; requestId: string | null; now: Date }): Promise<ApplyResult> {
    const p = a.plan;
    const r = await this.pool.query<{ r: { result: 'applied' | 'duplicate' | 'replan'; receipt_id?: string } }>('select private.apply_payment($1) as r', [
      JSON.stringify({
        tenant_id: a.invoice.tenantId,
        invoice_id: a.invoice.id,
        expected_status: a.invoice.status,
        expected_balance: a.invoice.balanceMinor,
        now: a.now.toISOString(),
        request_id: a.requestId,
        receipt: {
          method: a.receipt.method,
          source: a.receipt.source,
          provider_ref: a.receipt.providerRef,
          amount: a.receipt.amountMinor,
          currency: a.receipt.currency,
          received_at: a.receipt.receivedAt.toISOString(),
          confirmed_by: a.receipt.confirmedBy,
          payment_event_id: a.receipt.paymentEventId,
          proof_id: a.receipt.proofId,
          note: a.receipt.note,
        },
        plan: {
          applied: p.applied,
          credit: p.credit,
          transition_to: p.transition?.to ?? null,
          promise_outcome: p.promiseOutcome,
          events: p.events,
          tasks: p.tasks,
          send_receipt: p.sendReceipt,
        },
      }),
    ]);
    const out = r.rows[0]?.r;
    if (!out) throw new Error('apply_payment returned nothing');
    return out.result === 'replan' ? { result: 'replan' } : { result: out.result, receiptId: String(out.receipt_id) };
  }

  async receiptByRef(tenantId: string, method: string, providerRef: string): Promise<{ id: string; invoiceId: string; amount: number } | null> {
    const r = await this.pool.query<{ id: string; invoice_id: string; amount: string }>('select id, invoice_id, amount from public.receipts where tenant_id = $1 and method = $2 and provider_ref = $3', [tenantId, method, providerRef]);
    const x = r.rows[0];
    return x ? { id: x.id, invoiceId: x.invoice_id, amount: Number(x.amount) } : null;
  }

  /** A task and (optionally) an event, exactly once per dedupe key. */
  async task(t: { tenantId: string; type: string; reason: string | null; invoiceId: string | null; urgent: boolean; details: Record<string, unknown>; dedupeKey: string; at: Date }): Promise<void> {
    await this.pool.query(
      `insert into public.tasks (tenant_id, type, reason, invoice_id, urgent, details, dedupe_key, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tenant_id, dedupe_key) do nothing`,
      [t.tenantId, t.type, t.reason, t.invoiceId, t.urgent, JSON.stringify(t.details), t.dedupeKey.slice(0, 300), t.at],
    );
  }
  async invoiceEvent(tenantId: string, invoiceId: string, type: string, key: string, payload: Record<string, unknown>, at: Date): Promise<void> {
    await this.pool.query(
      `insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at) values ($1, $2, $3, $4, $5, $6) on conflict (tenant_id, idempotency_key) do nothing`,
      [tenantId, invoiceId, type, JSON.stringify(payload), key, at],
    );
  }
  async tenantEvent(tenantId: string, type: string, key: string, payload: Record<string, unknown>, at: Date): Promise<void> {
    await this.pool.query(
      `insert into public.tenant_events (tenant_id, type, payload, idempotency_key, created_at) values ($1, $2, $3, $4, $5) on conflict (tenant_id, idempotency_key) do nothing`,
      [tenantId, type, JSON.stringify(payload), key, at],
    );
  }
  async firstNotification(tenantId: string, dedupeKey: string, kind: string, at: Date): Promise<boolean> {
    const r = await this.pool.query(`insert into public.notifications (tenant_id, dedupe_key, period, kind, created_at) values ($1, $2, 'once', $3, $4) on conflict (tenant_id, dedupe_key, period) do nothing`, [
      tenantId,
      dedupeKey.slice(0, 200),
      kind,
      at,
    ]);
    return (r.rowCount ?? 0) === 1;
  }
  async integrity(tenantId: string | null): Promise<{ finding: string; tenantId: string; ref: string; detail: string }[]> {
    const r = await this.pool.query<{ finding: string; tenant_id: string; ref: string; detail: string }>('select * from private.payment_integrity($1)', [tenantId]);
    return r.rows.map((x) => ({ finding: x.finding, tenantId: x.tenant_id, ref: x.ref, detail: x.detail }));
  }
}
