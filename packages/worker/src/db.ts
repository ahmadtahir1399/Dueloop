// The worker's database access over a direct, trusted Postgres connection (never the browser, never the
// Data API). Every timestamp comes from the injected clock; outcomes are recorded in single transactions.
import type pg from 'pg';

export interface Job {
  readonly msgId: number;
  readonly readCount: number;
  readonly invoiceId: string;
  readonly tenantId: string;
}

export interface ReceiptJob {
  readonly msgId: number;
  readonly readCount: number;
  readonly kind: string;
  readonly receiptId: string;
  readonly tenantId: string;
  readonly invoiceId: string;
}

export interface MessageRow {
  readonly id: string;
  readonly sendState: string;
  readonly attempt: number;
  readonly pendingSince: Date | null;
  readonly stepId: string | null;
}

export interface ApprovalRow {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly status: string;
  readonly version: number;
  readonly subjectOverride: string | null;
  readonly bodyOverride: string | null;
}

export interface EventSpec {
  readonly type: string;
  readonly key: string;
  readonly payload: Record<string, unknown>;
}

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export class WorkerDb {
  readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  // ---- queue -------------------------------------------------------------------------------------------
  async enqueue(batch: number, asOf: Date): Promise<number> {
    const r = await this.pool.query<{ n: number }>('select private.enqueue_due_actions($1, $2) as n', [batch, asOf]);
    return num(r.rows[0]?.n);
  }

  async claim(n: number, visibilitySeconds: number, filter: Record<string, string> = {}): Promise<Job[]> {
    const r = await this.pool.query<{ msg_id: string; read_ct: number; invoice_id: string; tenant_id: string }>(
      'select * from private.claim_actions($1, $2, $3)',
      [n, visibilitySeconds, JSON.stringify(filter)],
    );
    return r.rows.map((x) => ({ msgId: Number(x.msg_id), readCount: x.read_ct, invoiceId: x.invoice_id, tenantId: x.tenant_id }));
  }

  async ack(msgId: number): Promise<void> {
    await this.pool.query('select private.ack_action($1)', [msgId]);
  }

  async release(msgId: number, delaySeconds: number): Promise<void> {
    await this.pool.query('select private.release_action($1, $2)', [msgId, delaySeconds]);
  }

  async deadLetter(msgId: number, reason: string, attempts: number): Promise<void> {
    await this.pool.query('select private.dead_letter_action($1, $2, $3)', [msgId, reason, attempts]);
  }

  async sweepStale(thresholdSeconds: number, asOf: Date): Promise<{ tenantId: string; invoiceId: string; messageId: string }[]> {
    const r = await this.pool.query<{ tenant_id: string; invoice_id: string; message_id: string }>(
      `select * from private.sweep_stale_messages(make_interval(secs => $1), $2)`,
      [thresholdSeconds, asOf],
    );
    return r.rows.map((x) => ({ tenantId: x.tenant_id, invoiceId: x.invoice_id, messageId: x.message_id }));
  }

  async expireApprovals(maxAgeDays: number, asOf: Date): Promise<number> {
    const r = await this.pool.query<{ n: number }>('select private.expire_approvals(make_interval(days => $1), $2) as n', [maxAgeDays, asOf]);
    return num(r.rows[0]?.n);
  }

  // ---- flags -------------------------------------------------------------------------------------------
  async pausedFor(tenantId: string): Promise<'global' | 'tenant' | null> {
    const r = await this.pool.query<{ g: boolean; t: boolean }>(
      `select private.flag('outbound_paused') as g, coalesce((select outbound_paused from public.tenants where id = $1), true) as t`,
      [tenantId],
    );
    const row = r.rows[0];
    return row?.g ? 'global' : row?.t ? 'tenant' : null;
  }

  async customerOptedOut(customerId: string): Promise<boolean> {
    const r = await this.pool.query<{ o: boolean }>('select opted_out as o from public.customers where id = $1', [customerId]);
    return r.rows[0]?.o ?? true;
  }

  /** Status and balance as of now (prompt 5 payment gate, issue L). */
  async invoiceBalance(tenantId: string, invoiceId: string): Promise<{ status: string; balance: number } | null> {
    const r = await this.pool.query<{ status: string; balance: string }>(
      'select i.status, b.balance from public.invoices i join public.invoice_balances b on b.tenant_id = i.tenant_id and b.invoice_id = i.id where i.tenant_id = $1 and i.id = $2',
      [tenantId, invoiceId],
    );
    const x = r.rows[0];
    return x ? { status: x.status, balance: Number(x.balance) } : null;
  }

  // ---- prompt 4 gates ------------------------------------------------------------------------------------
  /** The latest reminder block of an OPEN task on this invoice that has not expired yet (pipeline gate L). */
  async openBlockingTask(tenantId: string, invoiceId: string, at: Date): Promise<{ until: Date } | null> {
    const r = await this.pool.query<{ until: Date | null }>(
      `select max(blocks_reminders_until) as until from public.tasks
       where tenant_id = $1 and invoice_id = $2 and status = 'open' and blocks_reminders_until > $3`,
      [tenantId, invoiceId, at],
    );
    const until = r.rows[0]?.until ?? null;
    return until ? { until } : null;
  }

  /** Expired blocks of still-open tasks, each returned exactly once (the owner is alerted once, then reminders resume). */
  async claimExpiredBlockAlerts(tenantId: string, invoiceId: string, at: Date): Promise<{ taskId: string; type: string }[]> {
    const r = await this.pool.query<{ id: string; type: string }>(
      `update public.tasks set block_expiry_alerted = true
       where tenant_id = $1 and invoice_id = $2 and status = 'open' and blocks_reminders_until <= $3 and not block_expiry_alerted
       returning id, type`,
      [tenantId, invoiceId, at],
    );
    return r.rows.map((x) => ({ taskId: x.id, type: x.type }));
  }

  /** decide()'s mark_promise_broken also ends the active promise row (issue G). */
  async markPromiseBroken(tenantId: string, invoiceId: string, at: Date): Promise<void> {
    await this.pool.query(
      `update public.promises set status = 'broken', resolved_at = $3, resolved_by = 'worker' where tenant_id = $1 and invoice_id = $2 and status = 'active'`,
      [tenantId, invoiceId, at],
    );
  }

  /**
   * approval_mode 'low_confidence' (issue N): approval is required when this invoice has an open human_review
   * task, or the customer has an unresolved low-confidence/invalid reply task from the last 14 days.
   */
  async hasOpenLowConfidenceReview(tenantId: string, invoiceId: string, customerId: string, since: Date): Promise<boolean> {
    const r = await this.pool.query(
      `select 1 from public.tasks where tenant_id = $1 and status = 'open' and (
         (invoice_id = $2 and type = 'human_review')
         or (customer_id = $3 and reason in ('low_confidence', 'invalid_output') and created_at >= $4)
       ) limit 1`,
      [tenantId, invoiceId, customerId, since],
    );
    return r.rows.length > 0;
  }

  /**
   * A final gate stopped a send AFTER the outbox claim but BEFORE the adapter was called: provably not sent,
   * so the row returns to 'retry' with the attempt given back (the same key may be used later).
   */
  async abandonClaim(messageId: string, reason: string): Promise<void> {
    await this.pool.query(
      `update public.messages set send_state = 'retry', attempt = greatest(attempt - 1, 0), failed_reason = $2 where id = $1 and send_state = 'pending'`,
      [messageId, reason.slice(0, 200)],
    );
  }

  // ---- invoice state -------------------------------------------------------------------------------------
  /** Optimistic status change: only if the invoice is still in `from` (else someone else moved it). */
  async transition(tenantId: string, invoiceId: string, from: string, to: string, event: EventSpec): Promise<boolean> {
    return this.tx(async (c) => {
      const u = await c.query('update public.invoices set status = $3 where tenant_id = $1 and id = $2 and status = $4', [tenantId, invoiceId, to, from]);
      if (u.rowCount !== 1) return false;
      await this.appendEvent(c, tenantId, invoiceId, event);
      return true;
    });
  }

  async appendEvent(c: pg.PoolClient | pg.Pool, tenantId: string, invoiceId: string, e: EventSpec): Promise<void> {
    await c.query(
      `insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key)
       values ($1, $2, $3, $4, $5) on conflict (tenant_id, idempotency_key) do nothing`,
      [tenantId, invoiceId, e.type, JSON.stringify(e.payload), e.key],
    );
  }

  async setNextAction(tenantId: string, invoiceId: string, at: Date | 'infinity', parkedReason: string | null, event?: EventSpec): Promise<void> {
    await this.tx(async (c) => {
      await c.query(
        'update public.invoices set next_action_at = $3, parked_reason = $4, enqueued_at = null where tenant_id = $1 and id = $2',
        [tenantId, invoiceId, at === 'infinity' ? 'infinity' : at, parkedReason],
      );
      if (event) await this.appendEvent(c, tenantId, invoiceId, event);
    });
  }

  // ---- approvals -----------------------------------------------------------------------------------------
  async approvalFor(tenantId: string, key: string): Promise<ApprovalRow | null> {
    const r = await this.pool.query<{ id: string; idempotency_key: string; status: string; version: number; subject_override: string | null; body_override: string | null }>(
      'select id, idempotency_key, status, version, subject_override, body_override from public.approvals where tenant_id = $1 and idempotency_key = $2',
      [tenantId, key],
    );
    const a = r.rows[0];
    return a
      ? { id: a.id, idempotencyKey: a.idempotency_key, status: a.status, version: a.version, subjectOverride: a.subject_override, bodyOverride: a.body_override }
      : null;
  }

  /** Creates (or re-opens an expired/superseded) approval for exactly this key and parks the invoice. */
  async requestApproval(tenantId: string, invoiceId: string, key: string, stepId: string, channel: string, at: Date): Promise<number> {
    return this.tx(async (c) => {
      const r = await c.query<{ version: number }>(
        `insert into public.approvals (tenant_id, invoice_id, idempotency_key, step_id, channel, requested_at)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (tenant_id, idempotency_key) do update
           set status = 'pending', version = public.approvals.version + 1, requested_at = excluded.requested_at,
               decided_at = null, decided_by = null, decision_note = null
           where public.approvals.status in ('expired', 'superseded')
         returning version`,
        [tenantId, invoiceId, key, stepId, channel, at],
      );
      const version = r.rows[0]?.version;
      await c.query(
        `update public.invoices set next_action_at = 'infinity', parked_reason = 'awaiting_approval', enqueued_at = null where tenant_id = $1 and id = $2`,
        [tenantId, invoiceId],
      );
      if (version !== undefined) {
        await this.appendEvent(c, tenantId, invoiceId, {
          type: 'ApprovalRequested',
          key: `${key}:approval-requested:v${version}`,
          payload: { stepId, channel, version },
        });
      }
      return version ?? 0;
    });
  }

  /** Approvals for this invoice whose key decide() no longer proposes become 'superseded' (rule 16). */
  async supersedeApprovals(tenantId: string, invoiceId: string, exceptKey: string | null, reason: string, at: Date): Promise<number> {
    return this.tx(async (c) => {
      const r = await c.query<{ idempotency_key: string; version: number; id: string }>(
        `update public.approvals set status = 'superseded', decided_at = $4, decided_by = 'system', decision_note = $5
         where tenant_id = $1 and invoice_id = $2 and status in ('pending', 'approved') and idempotency_key is distinct from $3
         returning id, idempotency_key, version`,
        [tenantId, invoiceId, exceptKey, at, reason],
      );
      for (const a of r.rows) {
        await this.appendEvent(c, tenantId, invoiceId, {
          type: 'ApprovalSuperseded',
          key: `${a.idempotency_key}:approval-superseded:v${a.version}`,
          payload: { approvalId: a.id, reason },
        });
      }
      return r.rowCount ?? 0;
    });
  }

  // ---- outbox --------------------------------------------------------------------------------------------
  async message(tenantId: string, key: string): Promise<MessageRow | null> {
    const r = await this.pool.query<{ id: string; send_state: string; attempt: number; pending_since: Date | null; step_id: string | null }>(
      'select id, send_state, attempt, pending_since, step_id from public.messages where tenant_id = $1 and idempotency_key = $2',
      [tenantId, key],
    );
    const m = r.rows[0];
    return m ? { id: m.id, sendState: m.send_state, attempt: m.attempt, pendingSince: m.pending_since, stepId: m.step_id } : null;
  }

  /** Step 5 of the protocol: the envelope goes in the log BEFORE the walk to the post box. */
  async claimMessage(args: {
    tenantId: string;
    invoiceId: string;
    customerId: string;
    channel: string;
    key: string;
    stepId: string;
    templateKey: string;
    costMinor: number;
    subject: string | null;
    body: string;
    rfcMessageId: string | null;
    at: Date;
  }): Promise<string | null> {
    return this.tx(async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key, send_state, attempt, cost_minor,
                                      step_id, template_key, subject, body, rfc_message_id, pending_since)
         values ($1, $2, $3, 'out', $4, 'pending', 1, $5, $6, $7, $8, $9, $10, $11)
         on conflict (tenant_id, idempotency_key) do nothing
         returning id`,
        [args.tenantId, args.customerId, args.channel, args.key, args.costMinor, args.stepId, args.templateKey, args.subject, args.body, args.rfcMessageId, args.at],
      );
      const id = r.rows[0]?.id ?? null;
      if (id) {
        await c.query('insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)', [args.tenantId, id, args.invoiceId]);
      }
      return id;
    });
  }

  /** A 'retry' message may be attempted again: only one worker wins this conditional update. */
  async reclaimRetry(messageId: string, at: Date, body: string, subject: string | null): Promise<number | null> {
    const r = await this.pool.query<{ attempt: number }>(
      `update public.messages set send_state = 'pending', attempt = attempt + 1, pending_since = $2, body = $3, subject = $4
       where id = $1 and send_state = 'retry' returning attempt`,
      [messageId, at, body, subject],
    );
    return r.rows[0]?.attempt ?? null;
  }

  async recordSent(a: { tenantId: string; invoiceId: string; messageId: string; key: string; stepId: string; channel: string; providerMessageId: string | null; at: Date; nextActionAt: Date }): Promise<void> {
    await this.tx(async (c) => {
      await c.query(
        `update public.messages set send_state = 'sent', sent_at = $2, provider_message_id = coalesce($3, provider_message_id), failed_reason = null
         where id = $1 and send_state in ('pending', 'unknown')`,
        [a.messageId, a.at, a.providerMessageId],
      );
      await this.appendEvent(c, a.tenantId, a.invoiceId, { type: 'ReminderSent', key: `${a.key}:sent`, payload: { stepId: a.stepId, channel: a.channel } });
      await c.query(
        'update public.invoices set next_action_at = $3, parked_reason = null, enqueued_at = null where tenant_id = $1 and id = $2',
        [a.tenantId, a.invoiceId, a.nextActionAt],
      );
    });
  }

  async recordRetry(messageId: string, reason: string): Promise<void> {
    await this.pool.query(`update public.messages set send_state = 'retry', failed_reason = $2 where id = $1 and send_state = 'pending'`, [messageId, reason.slice(0, 200)]);
  }

  /** Permanent failure: the step counts as skipped (decide moves on), the owner is alerted by the caller. */
  async recordPermanent(a: { tenantId: string; invoiceId: string; messageId: string; key: string; stepId: string; channel: string; reason: string; at: Date }): Promise<void> {
    await this.tx(async (c) => {
      await c.query(`update public.messages set send_state = 'failed_permanent', failed_reason = $2 where id = $1 and send_state = 'pending'`, [a.messageId, a.reason.slice(0, 200)]);
      await this.appendEvent(c, a.tenantId, a.invoiceId, { type: 'ReminderFailed', key: `${a.key}:failed`, payload: { stepId: a.stepId, channel: a.channel, reason: a.reason.slice(0, 100) } });
      await c.query('update public.invoices set next_action_at = $3, parked_reason = null, enqueued_at = null where tenant_id = $1 and id = $2', [a.tenantId, a.invoiceId, a.at]);
    });
  }

  /** A step that cannot be sent to this customer (no contact, no consent) is recorded as skipped. */
  async recordSkip(a: { tenantId: string; invoiceId: string; customerId: string; key: string; stepId: string; channel: string; reason: string; at: Date }): Promise<void> {
    await this.tx(async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key, send_state, step_id, failed_reason, pending_since)
         values ($1, $2, $3, 'out', $4, 'skipped', $5, $6, $7) on conflict (tenant_id, idempotency_key) do nothing returning id`,
        [a.tenantId, a.customerId, a.channel, a.key, a.stepId, a.reason, a.at],
      );
      if (r.rows[0]) {
        await c.query('insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)', [a.tenantId, r.rows[0].id, a.invoiceId]);
      }
      await this.appendEvent(c, a.tenantId, a.invoiceId, { type: 'ReminderSkipped', key: `${a.key}:skipped`, payload: { stepId: a.stepId, channel: a.channel, reason: a.reason } });
      await c.query('update public.invoices set next_action_at = $3, parked_reason = null, enqueued_at = null where tenant_id = $1 and id = $2', [a.tenantId, a.invoiceId, a.at]);
    });
  }

  /** A stale pending message found at claim time: unknown, parked, never resent (rule 17). */
  async markUnknown(tenantId: string, invoiceId: string, messageId: string, key: string): Promise<void> {
    await this.tx(async (c) => {
      await c.query(`update public.messages set send_state = 'unknown', failed_reason = 'stale_pending' where id = $1 and send_state = 'pending'`, [messageId]);
      await this.appendEvent(c, tenantId, invoiceId, { type: 'MessageStateUnknown', key: `${key}:unknown`, payload: { messageId } });
      await c.query(`update public.invoices set next_action_at = 'infinity', parked_reason = 'message_unknown', enqueued_at = null where tenant_id = $1 and id = $2`, [tenantId, invoiceId]);
    });
  }

  async messageInvoice(messageId: string): Promise<{ tenantId: string; invoiceId: string } | null> {
    const r = await this.pool.query<{ tenant_id: string; invoice_id: string }>(
      'select tenant_id, invoice_id from public.message_invoices where message_id = $1 limit 1',
      [messageId],
    );
    const row = r.rows[0];
    return row ? { tenantId: row.tenant_id, invoiceId: row.invoice_id } : null;
  }

  /** Human reconciliation of an unknown message (`pnpm messages resolve`); use worker reconcileMessage(). */
  async resolveUnknown(messageId: string, as: 'sent' | 'not_sent', nextActionAt: Date): Promise<boolean> {
    const at = nextActionAt;
    return this.tx(async (c) => {
      const m = await c.query<{ tenant_id: string; idempotency_key: string; step_id: string; channel: string; invoice_id: string; purpose: string }>(
        `select m.tenant_id, m.idempotency_key, m.step_id, m.channel, mi.invoice_id, m.purpose from public.messages m
         join public.message_invoices mi on mi.tenant_id = m.tenant_id and mi.message_id = m.id
         where m.id = $1 and m.send_state = 'unknown' for update of m`,
        [messageId],
      );
      const row = m.rows[0];
      if (!row) return false;
      if (row.purpose === 'receipt') {
        // A receipt is not a reminder step: no ReminderSent, no change to the invoice's schedule. "not sent"
        // re-queues the receipt job (a human decided; still the same key, so still at most once).
        if (as === 'sent') await c.query(`update public.messages set send_state = 'sent', sent_at = coalesce(sent_at, pending_since) where id = $1`, [messageId]);
        else {
          await c.query(`update public.messages set send_state = 'retry', failed_reason = 'reconciled_not_sent' where id = $1`, [messageId]);
          await c.query(`select pgmq.send('transactional_sends', $1::jsonb)`, [
            JSON.stringify({ kind: 'receipt', receipt_id: row.idempotency_key.replace(/^receipt:/, ''), tenant_id: row.tenant_id, invoice_id: row.invoice_id }),
          ]);
        }
        await this.appendEvent(c, row.tenant_id, row.invoice_id, { type: 'MessageReconciled', key: `${row.idempotency_key}:reconciled-${as}`, payload: { as } });
        return true;
      }
      if (as === 'sent') {
        await c.query(`update public.messages set send_state = 'sent', sent_at = coalesce(sent_at, pending_since) where id = $1`, [messageId]);
        await this.appendEvent(c, row.tenant_id, row.invoice_id, { type: 'ReminderSent', key: `${row.idempotency_key}:sent`, payload: { stepId: row.step_id, channel: row.channel, reconciled: true } });
      } else {
        // Re-open the step: the same key may be attempted again (a human confirmed it was not delivered).
        await c.query(`update public.messages set send_state = 'retry', failed_reason = 'reconciled_not_sent' where id = $1`, [messageId]);
      }
      await this.appendEvent(c, row.tenant_id, row.invoice_id, { type: 'MessageReconciled', key: `${row.idempotency_key}:reconciled-${as}`, payload: { as } });
      await c.query('update public.invoices set next_action_at = $3, parked_reason = null, enqueued_at = null where tenant_id = $1 and id = $2', [row.tenant_id, row.invoice_id, at]);
      return true;
    });
  }

  // ---- receipts (prompt 5, issue K): the transactional_sends queue, filled inside apply_payment -----------
  async claimReceipts(n: number, visibilitySeconds: number, filter: Record<string, string> = {}): Promise<ReceiptJob[]> {
    const r = await this.pool.query<{ msg_id: string; read_ct: number; message: { kind: string; receipt_id: string; tenant_id: string; invoice_id: string } }>(
      'select msg_id, read_ct, message from pgmq.read($1::text, $2::integer, $3::integer, $4::jsonb)',
      ['transactional_sends', visibilitySeconds, n, JSON.stringify(filter)],
    );
    return r.rows.map((x) => ({ msgId: Number(x.msg_id), readCount: x.read_ct, kind: x.message.kind, receiptId: x.message.receipt_id, tenantId: x.message.tenant_id, invoiceId: x.message.invoice_id }));
  }
  async ackReceipt(msgId: number): Promise<void> {
    await this.pool.query(`select pgmq.archive('transactional_sends', $1::bigint)`, [msgId]);
  }
  async releaseReceipt(msgId: number, delaySeconds: number): Promise<void> {
    await this.pool.query(`select pgmq.set_vt('transactional_sends', $1::bigint, $2::integer)`, [msgId, delaySeconds]);
  }
  async deadLetterReceipt(job: ReceiptJob, reason: string, attempts: number): Promise<void> {
    await this.tx(async (c) => {
      await c.query(`insert into public.dead_letters (tenant_id, source, reason, attempts, payload) values ($1, 'transactional_sends', $2, $3, $4)`, [
        job.tenantId,
        reason.slice(0, 200),
        attempts,
        JSON.stringify({ receiptId: job.receiptId }),
      ]);
      await c.query(`select pgmq.archive('transactional_sends', $1::bigint)`, [job.msgId]);
    });
  }
  /** The receipt's amount, and the balance right AFTER it (later receipts' applied slices added back). */
  async receiptFacts(tenantId: string, receiptId: string): Promise<{ amount: number; currency: string; balanceAfter: number } | null> {
    const r = await this.pool.query<{ amount: string; currency: string; balance_after: string }>(
      `select r.amount, r.currency, b.balance + coalesce((
                select sum(p.amount) from public.payments p join public.receipts r2 on r2.tenant_id = p.tenant_id and r2.id = p.receipt_id
                where r2.tenant_id = r.tenant_id and r2.invoice_id = r.invoice_id and r2.created_at > r.created_at), 0) as balance_after
       from public.receipts r join public.invoice_balances b on b.tenant_id = r.tenant_id and b.invoice_id = r.invoice_id
       where r.tenant_id = $1 and r.id = $2`,
      [tenantId, receiptId],
    );
    const x = r.rows[0];
    return x ? { amount: Number(x.amount), currency: x.currency.trim(), balanceAfter: Number(x.balance_after) } : null;
  }
  async claimReceiptMessage(a: { tenantId: string; invoiceId: string; customerId: string; channel: string; key: string; costMinor: number; subject: string | null; body: string; rfcMessageId: string | null; at: Date }): Promise<string | null> {
    return this.tx(async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into public.messages (tenant_id, customer_id, channel, direction, purpose, idempotency_key, send_state, attempt, cost_minor, template_key, subject, body, rfc_message_id, pending_since)
         values ($1, $2, $3, 'out', 'receipt', $4, 'pending', 1, $5, 'receipt', $6, $7, $8, $9)
         on conflict (tenant_id, idempotency_key) do nothing returning id`,
        [a.tenantId, a.customerId, a.channel, a.key, a.costMinor, a.subject, a.body, a.rfcMessageId, a.at],
      );
      const id = r.rows[0]?.id ?? null;
      if (id) await c.query('insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)', [a.tenantId, id, a.invoiceId]);
      return id;
    });
  }
  async recordReceiptSent(messageId: string, providerMessageId: string | null, at: Date): Promise<void> {
    await this.pool.query(
      `update public.messages set send_state = 'sent', sent_at = $2, provider_message_id = coalesce($3, provider_message_id), failed_reason = null where id = $1 and send_state in ('pending', 'unknown')`,
      [messageId, at, providerMessageId],
    );
  }
  async recordReceiptFailed(messageId: string, reason: string): Promise<void> {
    await this.pool.query(`update public.messages set send_state = 'failed_permanent', failed_reason = $2 where id = $1 and send_state = 'pending'`, [messageId, reason.slice(0, 200)]);
  }
  /** Stale pending receipt: unknown, never resent (rule 17). Unlike a reminder it does not park the invoice. */
  async markReceiptUnknown(tenantId: string, invoiceId: string, messageId: string, key: string): Promise<void> {
    await this.tx(async (c) => {
      await c.query(`update public.messages set send_state = 'unknown', failed_reason = 'stale_pending' where id = $1 and send_state = 'pending'`, [messageId]);
      await this.appendEvent(c, tenantId, invoiceId, { type: 'MessageStateUnknown', key: `${key}:unknown`, payload: { messageId } });
    });
  }
  /** A receipt that will not be sent (opted out, no route, budget): recorded, never retried. */
  async recordReceiptSkipped(a: { tenantId: string; invoiceId: string; customerId: string; key: string; channel: string; reason: string; receiptId: string; at: Date }): Promise<void> {
    await this.tx(async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into public.messages (tenant_id, customer_id, channel, direction, purpose, idempotency_key, send_state, template_key, failed_reason, pending_since)
         values ($1, $2, $3, 'out', 'receipt', $4, 'skipped', 'receipt', $5, $6) on conflict (tenant_id, idempotency_key) do nothing returning id`,
        [a.tenantId, a.customerId, a.channel, a.key, a.reason, a.at],
      );
      if (r.rows[0]) await c.query('insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)', [a.tenantId, r.rows[0].id, a.invoiceId]);
      await this.appendEvent(c, a.tenantId, a.invoiceId, { type: 'ReceiptSkipped', key: `${a.key}:skipped`, payload: { receiptId: a.receiptId, channel: a.channel, reason: a.reason } });
    });
  }

  // ---- alerts --------------------------------------------------------------------------------------------
  /** True exactly once per (tenant, dedupeKey, period): the caller sends the alert only then. */
  async firstNotification(tenantId: string, dedupeKey: string, period: string, kind: string, at: Date): Promise<boolean> {
    const r = await this.pool.query(
      `insert into public.notifications (tenant_id, dedupe_key, period, kind, created_at) values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, dedupe_key, period) do nothing`,
      [tenantId, dedupeKey.slice(0, 200), period, kind, at],
    );
    return (r.rowCount ?? 0) === 1;
  }

  async secret(tenantId: string, channel: string): Promise<string | null> {
    const r = await this.pool.query<{ s: string | null }>('select private.channel_secret($1, $2) as s', [tenantId, channel]);
    return r.rows[0]?.s ?? null;
  }
}
