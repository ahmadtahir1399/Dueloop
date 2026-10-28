// Database access for the proof inbox (trusted direct connection).
import type pg from 'pg';
import type { ProofMessage } from './media.ts';

export interface ProofJob {
  readonly msgId: number;
  readonly readCount: number;
  readonly tenantId: string;
  readonly messageId: string;
}

export interface ProofRow {
  readonly id: string;
  readonly tenantId: string;
  readonly invoiceId: string | null;
  readonly customerId: string | null;
  readonly storagePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly mime: string;
  readonly originalName: string | null;
  readonly status: 'pending' | 'confirmed' | 'rejected';
  readonly duplicateOf: string | null;
  readonly hints: Record<string, unknown>;
  readonly createdAt: Date;
}

const proof = (x: Record<string, unknown>): ProofRow => ({
  id: String(x.id),
  tenantId: String(x.tenant_id),
  invoiceId: (x.invoice_id as string | null) ?? null,
  customerId: (x.customer_id as string | null) ?? null,
  storagePath: String(x.storage_path),
  sha256: String(x.sha256),
  sizeBytes: Number(x.size_bytes),
  mime: String(x.mime),
  originalName: (x.original_name as string | null) ?? null,
  status: x.status as ProofRow['status'],
  duplicateOf: (x.duplicate_of as string | null) ?? null,
  hints: (x.hints as Record<string, unknown>) ?? {},
  createdAt: x.created_at as Date,
});

export class ProofsDb {
  readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async claim(n: number, vt: number, filter: Record<string, string> = {}): Promise<ProofJob[]> {
    const r = await this.pool.query<{ msg_id: string; read_ct: number; message: { tenant_id: string; message_id: string } }>(
      'select msg_id, read_ct, message from pgmq.read($1::text, $2::integer, $3::integer, $4::jsonb)',
      ['proof_fetch', vt, n, JSON.stringify(filter)],
    );
    return r.rows.map((x) => ({ msgId: Number(x.msg_id), readCount: x.read_ct, tenantId: x.message.tenant_id, messageId: x.message.message_id }));
  }
  async ack(msgId: number): Promise<void> {
    await this.pool.query(`select pgmq.archive('proof_fetch', $1::bigint)`, [msgId]);
  }
  async release(msgId: number, delay: number): Promise<void> {
    await this.pool.query(`select pgmq.set_vt('proof_fetch', $1::bigint, $2::integer)`, [msgId, delay]);
  }
  async deadLetter(job: ProofJob, reason: string): Promise<void> {
    await this.pool.query(`insert into public.dead_letters (tenant_id, source, reason, attempts, payload) values ($1, 'proof_fetch', $2, $3, $4)`, [
      job.tenantId,
      reason.slice(0, 200),
      job.readCount,
      JSON.stringify({ messageId: job.messageId }),
    ]);
    await this.ack(job.msgId);
  }

  async message(tenantId: string, messageId: string): Promise<ProofMessage | null> {
    const r = await this.pool.query<{ channel: ProofMessage['channel']; customer_id: string | null; attachments: ProofMessage['attachments']; raw_mime: string | null; payload: Record<string, unknown> | null; invoice_ids: string[] }>(
      `select m.channel, m.customer_id, m.attachments, ie.raw_mime, ie.payload,
              array(select mi.invoice_id::text from public.message_invoices mi where mi.tenant_id = m.tenant_id and mi.message_id = m.id order by mi.invoice_id) as invoice_ids
       from public.messages m left join public.inbound_events ie on ie.tenant_id = m.tenant_id and ie.id = m.inbound_event_id
       where m.tenant_id = $1 and m.id = $2 and m.direction = 'in'`,
      [tenantId, messageId],
    );
    const x = r.rows[0];
    return x ? { tenantId, messageId, channel: x.channel, customerId: x.customer_id, attachments: x.attachments, rawMime: x.raw_mime, payload: x.payload, invoiceIds: x.invoice_ids } : null;
  }
  async tenant(tenantId: string): Promise<{ aiExtraction: boolean; storageCapBytes: number; timezone: string } | null> {
    const r = await this.pool.query<{ proof_ai_extraction: boolean; proof_storage_cap_bytes: string; timezone: string }>('select proof_ai_extraction, proof_storage_cap_bytes, timezone from public.tenants where id = $1', [tenantId]);
    const x = r.rows[0];
    return x ? { aiExtraction: x.proof_ai_extraction, storageCapBytes: Number(x.proof_storage_cap_bytes), timezone: x.timezone } : null;
  }
  async storedBytes(tenantId: string): Promise<number> {
    const r = await this.pool.query<{ n: string }>('select coalesce(sum(size_bytes), 0) as n from public.payment_proofs where tenant_id = $1', [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }
  /** Proofs from this customer on the tenant's local day of `at`. */
  async customerProofsToday(tenantId: string, customerId: string, timezone: string, at: Date): Promise<number> {
    const r = await this.pool.query<{ n: number }>(
      `select count(*)::int as n from public.payment_proofs where tenant_id = $1 and customer_id = $2
         and (created_at at time zone $3)::date = ($4::timestamptz at time zone $3)::date`,
      [tenantId, customerId, timezone, at],
    );
    return r.rows[0]?.n ?? 0;
  }
  async exists(tenantId: string, messageId: string, index: number): Promise<boolean> {
    return (await this.pool.query('select 1 from public.payment_proofs where tenant_id = $1 and message_id = $2 and attachment_index = $3', [tenantId, messageId, index])).rows.length > 0;
  }
  async earliestWithHash(tenantId: string, sha256: string): Promise<string | null> {
    const r = await this.pool.query<{ id: string }>('select id from public.payment_proofs where tenant_id = $1 and sha256 = $2 order by created_at, id limit 1', [tenantId, sha256]);
    return r.rows[0]?.id ?? null;
  }
  async invoiceRef(tenantId: string, invoiceId: string): Promise<{ currency: string; referenceCode: string; number: string } | null> {
    const r = await this.pool.query<{ currency: string; reference_code: string; number: string }>('select currency, reference_code, number from public.invoices where tenant_id = $1 and id = $2', [tenantId, invoiceId]);
    const x = r.rows[0];
    return x ? { currency: x.currency.trim(), referenceCode: x.reference_code, number: x.number } : null;
  }

  /** The proof row, its review task (blocking reminders while a human looks) and the event, in one transaction. */
  async insertProof(p: {
    id: string;
    tenantId: string;
    invoiceId: string | null;
    customerId: string | null;
    messageId: string;
    index: number;
    sha256: string;
    size: number;
    mime: string;
    name: string | null;
    duplicateOf: string | null;
    hints: Record<string, unknown>;
    modelId: string | null;
    promptVersion: string | null;
    blockDays: number;
    at: Date;
  }): Promise<boolean> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const r = await c.query(
        `insert into public.payment_proofs (id, tenant_id, invoice_id, customer_id, message_id, attachment_index, storage_path, sha256, size_bytes, mime, original_name, duplicate_of, hints, hints_model_id, hints_prompt_version, created_at)
         values ($1::uuid, $2::uuid, $3, $4, $5, $6, $2::text || '/' || $1::text, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         on conflict (tenant_id, message_id, attachment_index) do nothing returning id`,
        [p.id, p.tenantId, p.invoiceId, p.customerId, p.messageId, p.index, p.sha256, p.size, p.mime, p.name, p.duplicateOf, JSON.stringify(p.hints), p.modelId, p.promptVersion, p.at],
      );
      const inserted = r.rows.length === 1;
      if (inserted) {
        await c.query(
          `insert into public.tasks (tenant_id, type, reason, invoice_id, customer_id, message_id, details, blocks_reminders_until, dedupe_key, created_at)
           values ($1, 'review_proof', $2, $3, $4, $5, $6, $7, $8, $9) on conflict (tenant_id, dedupe_key) do nothing`,
          [
            p.tenantId,
            p.duplicateOf ? 'possible_duplicate' : 'new_proof',
            p.invoiceId,
            p.customerId,
            p.messageId,
            JSON.stringify({ proofId: p.id, duplicateOf: p.duplicateOf }),
            p.invoiceId ? new Date(p.at.getTime() + p.blockDays * 86_400_000) : null,
            `proof:${p.id}:review`,
            p.at,
          ],
        );
        if (p.invoiceId) {
          await c.query(
            `insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at) values ($1, $2, 'ProofSubmitted', $3, $4, $5) on conflict (tenant_id, idempotency_key) do nothing`,
            [p.tenantId, p.invoiceId, JSON.stringify({ proofId: p.id, duplicateOf: p.duplicateOf }), `proof:${p.id}:submitted`, p.at],
          );
        }
      }
      await c.query('commit');
      return inserted;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async task(t: { tenantId: string; type: 'review_proof' | 'proof_limit_reached'; reason: string; invoiceId: string | null; customerId: string | null; messageId: string; details: Record<string, unknown>; dedupeKey: string; at: Date }): Promise<void> {
    await this.pool.query(
      `insert into public.tasks (tenant_id, type, reason, invoice_id, customer_id, message_id, details, dedupe_key, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (tenant_id, dedupe_key) do nothing`,
      [t.tenantId, t.type, t.reason, t.invoiceId, t.customerId, t.messageId, JSON.stringify(t.details), t.dedupeKey, t.at],
    );
  }

  // ---- human workflow -----------------------------------------------------------------------------------
  async list(tenantId: string | null, status: string): Promise<ProofRow[]> {
    const r = await this.pool.query(`select * from public.payment_proofs where ($1::uuid is null or tenant_id = $1) and ($2 = 'all' or status = $2) order by created_at`, [tenantId, status]);
    return r.rows.map(proof);
  }
  async get(id: string): Promise<ProofRow | null> {
    const r = await this.pool.query('select * from public.payment_proofs where id = $1', [id]);
    return r.rows[0] ? proof(r.rows[0]) : null;
  }
  async balance(tenantId: string, invoiceId: string): Promise<{ balance: number; status: string } | null> {
    const r = await this.pool.query<{ balance: string; status: string }>(
      'select b.balance, i.status from public.invoice_balances b join public.invoices i on i.tenant_id = b.tenant_id and i.id = b.invoice_id where b.tenant_id = $1 and b.invoice_id = $2',
      [tenantId, invoiceId],
    );
    const x = r.rows[0];
    return x ? { balance: Number(x.balance), status: x.status } : null;
  }
  /** Receipts with the same amount on the same local day (step 13d: the same money entered twice by hand). */
  async sameAmountSameDay(tenantId: string, amount: number, day: string, timezone: string): Promise<string[]> {
    const r = await this.pool.query<{ id: string }>('select id from public.receipts where tenant_id = $1 and amount = $2 and (received_at at time zone $4)::date = $3::date', [tenantId, amount, day, timezone]);
    return r.rows.map((x) => x.id);
  }
  async markConfirmed(id: string, receiptId: string, userId: string, at: Date): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const p = await c.query<{ tenant_id: string; invoice_id: string | null }>(
        `update public.payment_proofs set status = 'confirmed', receipt_id = $2, decided_by = $3, decided_at = $4 where id = $1 and status = 'pending' returning tenant_id, invoice_id`,
        [id, receiptId, userId, at],
      );
      const x = p.rows[0];
      if (x) {
        await c.query(`update public.tasks set status = 'resolved', resolved_at = $3, resolved_by = 'proof', resolution_note = 'proof confirmed', blocks_reminders_until = null where tenant_id = $1 and dedupe_key = $2 and status = 'open'`, [x.tenant_id, `proof:${id}:review`, at]);
        if (x.invoice_id) await c.query(`insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at) values ($1, $2, 'ProofVerified', $3, $4, $5) on conflict (tenant_id, idempotency_key) do nothing`, [x.tenant_id, x.invoice_id, JSON.stringify({ proofId: id, receiptId }), `proof:${id}:verified`, at]);
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  /** Reject: the proof, its review task and the invoice's open payment-claim tasks are closed; reminders resume. */
  async markRejected(id: string, userId: string, reason: string, at: Date): Promise<{ tenantId: string; invoiceId: string | null } | null> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const p = await c.query<{ tenant_id: string; invoice_id: string | null }>(
        `update public.payment_proofs set status = 'rejected', decided_by = $2, decided_at = $3, decision_note = $4 where id = $1 and status = 'pending' returning tenant_id, invoice_id`,
        [id, userId, at, reason.slice(0, 500)],
      );
      const x = p.rows[0] ?? null;
      if (x) {
        await c.query(`update public.tasks set status = 'resolved', resolved_at = $3, resolved_by = 'proof', resolution_note = 'proof rejected', blocks_reminders_until = null where tenant_id = $1 and dedupe_key = $2 and status = 'open'`, [x.tenant_id, `proof:${id}:review`, at]);
        if (x.invoice_id) {
          await c.query(
            `update public.tasks set status = 'resolved', resolved_at = $3, resolved_by = 'proof', resolution_note = 'proof rejected', blocks_reminders_until = null
             where tenant_id = $1 and invoice_id = $2 and status = 'open' and type = 'verify_payment_claim'`,
            [x.tenant_id, x.invoice_id, at],
          );
          await c.query(`insert into public.invoice_events (tenant_id, invoice_id, type, payload, idempotency_key, created_at) values ($1, $2, 'ProofRejected', $3, $4, $5) on conflict (tenant_id, idempotency_key) do nothing`, [x.tenant_id, x.invoice_id, JSON.stringify({ proofId: id }), `proof:${id}:rejected`, at]);
          await c.query(`update public.invoices set next_action_at = $3, enqueued_at = null where tenant_id = $1 and id = $2 and status not in ('paid', 'written_off', 'cancelled')`, [x.tenant_id, x.invoice_id, at]);
        }
      }
      await c.query('commit');
      return x ? { tenantId: x.tenant_id, invoiceId: x.invoice_id } : null;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
}
