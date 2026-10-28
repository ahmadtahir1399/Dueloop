// One proof_fetch job = one inbound message: fetch each candidate attachment, validate it BEFORE anything else,
// store it privately, flag exact duplicates, optionally extract hints, and open a review task. Over a cap => a
// task, never a silent drop. Logs carry ids and codes only (no file names, no hints, no contents).
import { createHash } from 'node:crypto';
import type { Alert } from '@dueloop/messaging';
import type { ProofsDb, ProofJob } from './db.ts';
import { parseHints, type ImageMime, type ProofExtractor } from './extract.ts';
import type { MediaFetcher } from './media.ts';
import { sanitiseFileName, sniffProof } from './sniff.ts';
import type { ProofStore } from './store.ts';

export interface ProofsConfig {
  readonly maxPerMessage: number;
  readonly maxPerCustomerPerDay: number;
  readonly visibilitySeconds: number;
  readonly maxAttempts: number;
  readonly retryBaseSeconds: number;
  /** A proof on an invoice blocks reminders this long while a human looks (same as a payment claim). */
  readonly blockDays: number;
}
export const DEFAULT_PROOFS_CONFIG: ProofsConfig = { maxPerMessage: 5, maxPerCustomerPerDay: 10, visibilitySeconds: 120, maxAttempts: 5, retryBaseSeconds: 60, blockDays: 3 };

export interface ProofsDeps {
  readonly db: ProofsDb;
  readonly store: ProofStore;
  readonly media: MediaFetcher;
  /** null = no extractor configured; extraction also needs the tenant's opt-in. */
  readonly extractor: ProofExtractor | null;
  readonly clock: { now(): Date };
  readonly logger: { info(e: string, f?: Record<string, string | number | boolean | null>): void; warn(e: string, f?: Record<string, string | number | boolean | null>): void };
  readonly notifier: { notify(a: Alert): Promise<void> };
  readonly config: ProofsConfig;
}

/** Deterministic id per (message, attachment): a retry writes the same object path and the same row. */
export function proofIdFor(messageId: string, index: number): string {
  const h = createHash('sha256').update(`proof:${messageId}:${index}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const isCandidate = (mime: string) => mime.startsWith('image/') || mime === 'application/pdf';

export type ProofOutcome = { stored: number; duplicates: number; rejected: number; limited: number; skipped: number };

export async function processProofJob(job: ProofJob, deps: ProofsDeps): Promise<ProofOutcome | 'missing'> {
  const { db, clock, config, logger } = deps;
  const out: ProofOutcome = { stored: 0, duplicates: 0, rejected: 0, limited: 0, skipped: 0 };
  const m = await db.message(job.tenantId, job.messageId);
  const tenant = await db.tenant(job.tenantId);
  if (!m || !tenant) {
    await db.ack(job.msgId);
    return 'missing';
  }
  // Exactly one linked invoice => the proof is for it; several => a human picks (never guess, rule 24).
  const invoiceId = m.invoiceIds.length === 1 ? (m.invoiceIds[0] ?? null) : null;
  const inv = invoiceId ? await db.invoiceRef(job.tenantId, invoiceId) : null;
  const at = clock.now();
  const candidates = m.attachments.map((a, i) => ({ a, i })).filter((x) => isCandidate(x.a.mime));
  const limitTask = (reason: string, details: Record<string, unknown>) =>
    db.task({ tenantId: job.tenantId, type: 'proof_limit_reached', reason, invoiceId, customerId: m.customerId, messageId: m.messageId, details, dedupeKey: `proof-limit:${m.messageId}:${reason}`, at });

  if (candidates.length > config.maxPerMessage) {
    await limitTask('too_many_in_message', { attachments: candidates.length, limit: config.maxPerMessage });
    out.limited += candidates.length - config.maxPerMessage;
  }
  for (const { a, i } of candidates.slice(0, config.maxPerMessage)) {
    if (await db.exists(job.tenantId, m.messageId, i)) {
      out.skipped++;
      continue;
    }
    if (m.customerId && (await db.customerProofsToday(job.tenantId, m.customerId, tenant.timezone, at)) >= config.maxPerCustomerPerDay) {
      await limitTask('customer_daily_limit', { limit: config.maxPerCustomerPerDay });
      out.limited++;
      continue;
    }
    const fetched = await deps.media.fetch(m, i);
    if (!fetched.ok) {
      if (fetched.reason === 'unavailable') throw new ProofRetry('media_unavailable');
      await db.task({ tenantId: job.tenantId, type: 'review_proof', reason: fetched.reason === 'too_large' ? 'file_too_large' : 'file_not_found', invoiceId, customerId: m.customerId, messageId: m.messageId, details: { attachment: i }, dedupeKey: `proof-reject:${m.messageId}:${i}`, at });
      out.rejected++;
      continue;
    }
    const sniff = sniffProof(fetched.bytes);
    if (!sniff.ok) {
      // Not stored, not sent anywhere. A human sees that a file arrived and why it was refused.
      await db.task({ tenantId: job.tenantId, type: 'review_proof', reason: 'invalid_file', invoiceId, customerId: m.customerId, messageId: m.messageId, details: { attachment: i, check: sniff.reason }, dedupeKey: `proof-reject:${m.messageId}:${i}`, at });
      logger.warn('proof_rejected', { tenantId: job.tenantId, reason: sniff.reason });
      out.rejected++;
      continue;
    }
    if ((await db.storedBytes(job.tenantId)) + fetched.bytes.length > tenant.storageCapBytes) {
      await limitTask('storage_cap', { capBytes: tenant.storageCapBytes });
      out.limited++;
      continue;
    }
    const sha256 = createHash('sha256').update(fetched.bytes).digest('hex');
    const duplicateOf = await db.earliestWithHash(job.tenantId, sha256);
    const id = proofIdFor(m.messageId, i);
    let hints: Record<string, unknown> = {};
    let modelId: string | null = null;
    let promptVersion: string | null = null;
    // AI only with the tenant's opt-in, only for images (a PDF is for human eyes only), never for a duplicate.
    if (tenant.aiExtraction && deps.extractor && sniff.mime !== 'application/pdf' && !duplicateOf) {
      const r = await deps.extractor.extract(fetched.bytes, sniff.mime as ImageMime, sha256);
      if (r.ok) {
        const h = parseHints(r.raw, inv);
        if (h) hints = { ...h };
        modelId = r.modelId;
        promptVersion = r.promptVersion;
      }
    }
    await deps.store.put(`${job.tenantId}/${id}`, fetched.bytes, sniff.mime);
    const inserted = await db.insertProof({ id, tenantId: job.tenantId, invoiceId, customerId: m.customerId, messageId: m.messageId, index: i, sha256, size: fetched.bytes.length, mime: sniff.mime, name: sanitiseFileName(a.name), duplicateOf, hints, modelId, promptVersion, blockDays: config.blockDays, at });
    if (inserted) {
      out.stored++;
      if (duplicateOf) out.duplicates++;
    } else out.skipped++;
  }
  await db.ack(job.msgId);
  if (out.stored > 0) {
    try {
      await deps.notifier.notify({ tenantId: job.tenantId, dedupeKey: `proof:${m.messageId}`, kind: 'proof_received', severity: 'info', title: `A payment proof arrived${inv ? ` for invoice ${inv.number}` : ''}`, lines: ['Review it: pnpm proofs list'] });
    } catch {
      logger.warn('notify_failed', { tenantId: job.tenantId, reason: 'proof_received' });
    }
  }
  logger.info('proof_job_done', { tenantId: job.tenantId, count: out.stored, outcome: `rejected_${out.rejected}_limited_${out.limited}` });
  return out;
}

export class ProofRetry extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'ProofRetry';
  }
}

export async function processProofBatch(deps: ProofsDeps, opts: { limit: number; filter?: Record<string, string> }): Promise<{ claimed: number; outcomes: Record<string, number> }> {
  const jobs = await deps.db.claim(opts.limit, deps.config.visibilitySeconds, opts.filter ?? {});
  const outcomes: Record<string, number> = {};
  const add = (k: string, n = 1) => (outcomes[k] = (outcomes[k] ?? 0) + n);
  for (const job of jobs) {
    try {
      const r = await processProofJob(job, deps);
      if (r === 'missing') add('missing');
      else for (const [k, n] of Object.entries(r)) if (n) add(k, n);
    } catch (e) {
      if (e instanceof Error && e.name === 'FailpointCrash') throw e;
      if (job.readCount >= deps.config.maxAttempts) {
        await deps.db.deadLetter(job, e instanceof ProofRetry ? e.message : 'processing_error');
        add('dead_lettered');
      } else {
        await deps.db.release(job.msgId, deps.config.retryBaseSeconds * 2 ** Math.max(0, job.readCount - 1));
        add('retry');
      }
    }
  }
  return { claimed: jobs.length, outcomes };
}
