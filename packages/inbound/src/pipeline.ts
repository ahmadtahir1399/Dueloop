// The inbound processor (pipeline steps 2-10). Mailroom analogy: the signature check happened at the door
// (webhook/IMAP store); here the logbook entry is normalised, sorted (sender, dedupe, pre-filters, matching),
// a junior clerk fills in a form (classifier -> toProposal), and the supervisor (planReplyOutcome + the state
// machine, applied in ONE transaction) is the only one who touches the ledger. Nothing here can send.
import { nextSendWindow, planReplyOutcome, type Effect, type Proposal, type StatedAmount } from '@dueloop/core';
import { buildClassifierInput, toProposal, type ClassifierResult, type ToProposal } from '@dueloop/classifier';
import { normaliseEmail as normaliseAddress, normalisePhone, parseAmount } from '@dueloop/ingest/parsers';
import type { Alert } from '@dueloop/messaging';
import { DateTime } from 'luxon';
import type { ApplyRequest, ClaimedEvent, CustomerRow, InboundEventRow, InvoiceRow, TaskSpec, TenantRow } from './db.ts';
import { ambiguousInvoiceDraft, infoRequestDraft } from './drafts.ts';
import { normaliseEmail } from './email.ts';
import { matchInvoices, type MatchResult } from './match.ts';
import type { InboundDeps } from './ports.ts';
import { prefilter, type Prefilter } from './prefilter.ts';
import type { NormalisedMessage, NormalisedStatus } from './types.ts';
import { normaliseWhatsApp } from './whatsapp.ts';

export type InboundOutcome = 'processed' | 'duplicate' | 'status_applied' | 'status_ignored' | 'retry' | 'dead_lettered' | 'missing' | 'unprocessable';

/** A failure worth retrying through the queue (classifier outage, transient DB error). */
export class RetryableInbound extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type Log = Record<string, string | number | boolean | null>;

/** Issue K: relative dates resolve against when the customer WROTE, if the provider's timestamp is plausible. */
export function referenceTime(providerTs: Date | null, receivedAt: Date, now: Date, maxFutureSkewMs: number, maxAgeDays: number): Date {
  if (!providerTs) return receivedAt;
  const t = providerTs.getTime();
  if (t > now.getTime() + maxFutureSkewMs) return receivedAt;
  if (t < now.getTime() - maxAgeDays * 86_400_000) return receivedAt;
  return providerTs;
}

/** Code parses the stated amount (issue C2), never the model. Words like "half" stay unparsed => a human. */
export function parseStatedAmount(text: string | null, invoiceCurrency: string): StatedAmount {
  if (text === null || text.trim() === '') return { kind: 'none' };
  if (!/\d/.test(text)) return { kind: 'unparsed' };
  for (const decimal of ['.', ','] as const) {
    const r = parseAmount(text, decimal, (code) => code ?? invoiceCurrency);
    if (r.ok) return { kind: 'parsed', minor: r.minor, currency: r.currencyInCell ?? invoiceCurrency };
  }
  return { kind: 'unparsed' };
}

/** Start of the next local day's send window (rule D) — used when evidence turns unknown into sent. */
function nextDayWindow(now: Date, t: TenantRow): Date {
  const tomorrow = DateTime.fromJSDate(now).setZone(t.timezone).plus({ days: 1 }).startOf('day');
  const w = nextSendWindow(tomorrow, { timezone: t.timezone, quietHours: { startHour: t.quietStartHour, endHour: t.quietEndHour }, holidays: t.holidays });
  return w.ok ? w.at.toJSDate() : new Date(now.getTime() + 86_400_000);
}

const ALERTS: Record<string, { severity: Alert['severity']; title: (n: string) => string }> = {
  promise_recorded: { severity: 'info', title: (n) => `A customer promised to pay invoice ${n}` },
  dispute: { severity: 'critical', title: (n) => `A customer disputes invoice ${n}` },
  payment_claim: { severity: 'warning', title: (n) => `A customer says invoice ${n} is already paid: please verify` },
  abusive: { severity: 'critical', title: (n) => `An abusive reply about invoice ${n} needs attention` },
  opt_out: { severity: 'warning', title: () => 'A customer asked to stop receiving messages' },
  delivery_failed: { severity: 'warning', title: (n) => `A reminder for invoice ${n} could not be delivered` },
};

async function alertOnce(deps: InboundDeps, tenantId: string, dedupeKey: string, topic: string, invoiceNumber: string, lines: string[]): Promise<void> {
  const spec = ALERTS[topic];
  if (!spec) return;
  try {
    if (!(await deps.db.firstNotification(tenantId, dedupeKey, 'once', `reply_${topic}`, deps.clock.now()))) return;
    await deps.notifier.notify({ tenantId, dedupeKey, kind: `reply_${topic}`, severity: spec.severity, title: spec.title(invoiceNumber), lines });
  } catch {
    deps.logger.warn('notify_failed', { tenantId, reason: topic }); // a failed alert never fails processing
  }
}

/** Classify with one retry on invalid output; an outage throws (the event retries via the queue). */
async function classify(deps: InboundDeps, input: ReturnType<typeof buildClassifierInput>): Promise<{ tp: ToProposal; meta: Extract<ClassifierResult, { ok: true }> }> {
  for (let attempt = 1; ; attempt++) {
    const r = await deps.classifier.classify(input);
    if (!r.ok) throw new RetryableInbound(`classifier_${r.error}`);
    const tp = toProposal(r.raw);
    if (tp.kind === 'review' && tp.reason === 'invalid_output' && attempt < 2) continue;
    return { tp, meta: r };
  }
}

async function resolveSender(deps: InboundDeps, tenantId: string, m: NormalisedMessage): Promise<{ ref: string; customer: CustomerRow | null }> {
  if (m.channel === 'email') {
    const e = normaliseAddress(m.from);
    return { ref: e.email ?? m.from.toLowerCase().trim(), customer: e.email ? await deps.db.customerBy(tenantId, 'email', e.email) : null };
  }
  // WhatsApp sends international digits without "+"; the default country is irrelevant for those.
  const p = normalisePhone(`+${m.from}`, 'GB');
  return { ref: p.phone ?? `+${m.from}`, customer: p.phone ? await deps.db.customerBy(tenantId, 'phone_e164', p.phone) : null };
}

async function handleStatus(deps: InboundDeps, ev: InboundEventRow, s: NormalisedStatus, log: Log): Promise<InboundOutcome> {
  const res = await deps.db.applyStatus(ev.tenantId, s.providerMessageId, s.status, s.timestamp ?? ev.receivedAt);
  if (!res) {
    deps.logger.info('status_unknown_message', { ...log, status: s.status });
    return 'status_ignored';
  }
  if (s.status === 'failed' && res.changed) {
    // 131026: message undeliverable (e.g. not a WhatsApp number) => the contact is invalid.
    await deps.db.recordDeliveryFailure({
      tenantId: ev.tenantId,
      outboundMessageId: res.messageId,
      invoiceIds: res.invoiceIds,
      customerId: res.customerId,
      sourceMessageId: null,
      reason: `wa_${s.errorCode ?? 'failed'}`,
      invalidContact: s.errorCode === 131026,
      at: deps.clock.now(),
    });
    const inv = res.invoiceIds[0] ? await deps.db.invoice(ev.tenantId, res.invoiceIds[0]) : null;
    await alertOnce(deps, ev.tenantId, `delivery:${res.messageId}`, 'delivery_failed', inv?.number ?? '?', ['channel: whatsapp', `reason: wa_${s.errorCode ?? 'failed'}`]);
  }
  deps.logger.info('status_applied', { ...log, messageId: res.messageId, status: s.status, outcome: res.changed ? 'changed' : 'kept' });
  return 'status_applied';
}

const STORE_ONLY: readonly Prefilter[] = ['auto_reply', 'delivery_receipt', 'own_address', 'empty'];

async function handleMessage(deps: InboundDeps, ev: InboundEventRow, m: NormalisedMessage, log: Log): Promise<InboundOutcome> {
  const { db, clock, config, failpoints } = deps;
  const now = clock.now();
  const tenant = await db.tenant(ev.tenantId);
  const reference = referenceTime(m.providerTimestamp, ev.receivedAt, now, config.maxFutureSkewMs, config.maxProviderAgeDays);
  const sender = await resolveSender(deps, ev.tenantId, m);
  const customer = sender.customer;

  // Step 5: dedupe + store.
  const stored = await db.storeInbound({
    tenantId: ev.tenantId,
    eventId: ev.id,
    channel: m.channel,
    providerMessageId: m.providerMessageId,
    customerId: customer?.id ?? null,
    senderRef: sender.ref,
    body: m.fullText,
    newText: m.newText,
    subject: m.subject,
    inReplyTo: m.inReplyTo,
    references: m.references,
    providerTimestamp: m.providerTimestamp,
    receivedAt: ev.receivedAt,
    attachments: m.attachments,
  });
  if (stored.processedAt) return 'duplicate';
  failpoints.hit('after_message_insert', { eventId: ev.id });
  const messageId = stored.id;
  const mlog = { ...log, messageId };

  // Step 6: pre-filters. Thread ids are evidence even for auto-replies and bounces (issue M).
  const pf = prefilter(m, tenant.ownAddresses);
  const threadIds = [m.inReplyTo, ...m.references, m.report?.originalMessageId ?? null].filter((x): x is string => x !== null);
  const hits = await db.threadHits(ev.tenantId, threadIds);
  for (const h of hits.filter((x) => x.sendState === 'unknown')) {
    if (await db.resolveUnknownAsSent(h.messageId, nextDayWindow(now, tenant), pf === 'bounce' ? 'bounce' : 'reply')) deps.logger.info('unknown_resolved_sent', { ...mlog, outcome: pf });
  }

  const base = (over: Partial<ApplyRequest>): ApplyRequest => ({
    tenantId: ev.tenantId,
    messageId,
    customerId: customer?.id ?? null,
    invoiceId: null,
    expectedStatus: null,
    reference,
    now,
    effects: [],
    extraTasks: [],
    tenantEvents: [],
    linkInvoiceIds: [],
    drafts: {},
    messageFields: { matchedBy: 'none', prefilter: pf, analysis: null, modelId: null, promptVersion: null, latencyMs: null, tokensIn: null, tokensOut: null },
    ...over,
  });

  if (pf === 'bounce') {
    // The DSN names the exact message that bounced; without it, fall back to the thread ids.
    const bounced = m.report?.originalMessageId ? await db.threadHits(ev.tenantId, [m.report.originalMessageId]) : hits;
    for (const h of bounced) {
      await db.recordDeliveryFailure({
        tenantId: ev.tenantId,
        outboundMessageId: h.messageId,
        invoiceIds: h.invoiceIds,
        customerId: h.customerId,
        sourceMessageId: messageId,
        reason: `dsn_${m.report?.status ?? 'failed'}`,
        invalidContact: (m.report?.status ?? '').startsWith('5.1.'),
        at: now,
      });
      const inv = h.invoiceIds[0] ? await db.invoice(ev.tenantId, h.invoiceIds[0]) : null;
      await alertOnce(deps, ev.tenantId, `delivery:${h.messageId}`, 'delivery_failed', inv?.number ?? '?', ['channel: email', `reason: dsn_${m.report?.status ?? 'failed'}`]);
    }
    await db.applyPlan(base({ customerId: null }));
    deps.logger.info('inbound_bounce', { ...mlog, count: bounced.length });
    return 'processed';
  }
  if (STORE_ONLY.includes(pf)) {
    // Stored, no effects, never reaches the model, does not count as engagement.
    await db.applyPlan(base({ tenantEvents: pf === 'auto_reply' ? [{ type: 'AutoReplyReceived', key: `${messageId}:auto`, payload: {} }] : [] }));
    deps.logger.info('inbound_stored_only', { ...mlog, reason: pf });
    return 'processed';
  }
  if (!customer) {
    // Unknown sender (step 4): stored + a task; no effects, not even opt-out (it resolves to no one).
    await db.applyPlan(
      base({
        extraTasks: [{ type: 'unmatched_inbound', reason: 'unknown_sender', invoiceId: null, blocksRemindersDays: 0, draft: null, details: { channel: m.channel } }],
        tenantEvents: [{ type: 'ReplyUnmatched', key: `${messageId}:unmatched`, payload: { channel: m.channel } }],
      }),
    );
    deps.logger.info('inbound_unmatched', mlog);
    return 'processed';
  }

  // Step 6b: match (never guess). A thread hit counts only if that outbound message went to THIS customer.
  const ownHits = hits.filter((h) => h.customerId === customer.id);
  const openInvoices = await db.openInvoices(ev.tenantId, customer.id);
  const match: MatchResult = matchInvoices({ channel: m.channel, threadHits: ownHits, openInvoices, now });
  // Issue J: an email's From is spoofable; only a thread match to OUR Message-ID proves it. WhatsApp numbers
  // are verified by the provider.
  const senderTrusted = m.channel === 'whatsapp' || (match.kind === 'matched' && match.by === 'thread');

  // Step 7: classify (or the opt-out keyword pre-filter).
  let tp: ToProposal;
  let meta: Extract<ClassifierResult, { ok: true }> | null = null;
  if (pf === 'opt_out_keyword') {
    const proposal: Proposal = { intent: 'opt_out', confidence: 1, promisedDate: null, dateIsVague: false, statedAmountText: null };
    tp = { kind: 'proposal', proposal, language: customer.language, summary: { untrusted: '' } };
  } else {
    const dayStart = DateTime.fromJSDate(now).setZone(tenant.timezone).startOf('day').toJSDate();
    if ((await db.classificationsSince(ev.tenantId, dayStart)) >= tenant.classificationCap) {
      // Over the daily cap: a human looks; the message is never silently dropped.
      await db.applyPlan(
        base({
          invoiceId: match.kind === 'matched' ? (match.invoiceIds[0] ?? null) : null,
          linkInvoiceIds: match.kind === 'matched' ? match.invoiceIds : [],
          messageFields: { ...base({}).messageFields, matchedBy: match.kind === 'matched' ? match.by : 'none' },
          extraTasks: [{ type: 'human_review', reason: 'classification_cap', invoiceId: match.kind === 'matched' ? (match.invoiceIds[0] ?? null) : null, blocksRemindersDays: 0, draft: null, details: {} }],
        }),
      );
      deps.logger.warn('classification_cap', mlog);
      return 'processed';
    }
    const input = buildClassifierInput({
      text: m.newText,
      reference,
      timezone: tenant.timezone,
      currency: tenant.currency,
      localeHint: customer.language,
      redaction: { names: [customer.name, tenant.name], invoiceNumbers: openInvoices.map((i) => i.number) },
    });
    const c = await classify(deps, input);
    tp = c.tp;
    meta = c.meta;
  }
  failpoints.hit('after_classify', { eventId: ev.id });

  const analysis =
    tp.kind === 'proposal'
      ? { ...tp.proposal, language: tp.language, untrustedSummary: tp.summary.untrusted }
      : { review: tp.reason, intent: tp.intent, untrustedSummary: tp.summary?.untrusted ?? null };
  const messageFields: ApplyRequest['messageFields'] = {
    matchedBy: match.kind === 'matched' ? match.by : 'none',
    prefilter: pf,
    analysis,
    modelId: meta?.modelId ?? null,
    promptVersion: meta?.promptVersion ?? null,
    latencyMs: meta?.latencyMs ?? null,
    tokensIn: meta?.tokensIn ?? null,
    tokensOut: meta?.tokensOut ?? null,
  };

  // No single invoice: opt-out still honoured; anything else is a task listing the candidates.
  if (match.kind === 'none') {
    const effects: readonly Effect[] =
      tp.kind === 'proposal' && tp.proposal.intent === 'opt_out'
        ? planReplyOutcome({ proposal: tp.proposal, invoice: null, reference, timezone: tenant.timezone, senderTrusted, statedAmount: { kind: 'none' }, activePromise: null, renewalCount: 0, rules: config.rules }).effects
        : [];
    const candidates = match.candidates.map((c) => ({ invoiceId: c.invoiceId, number: c.number }));
    await db.applyPlan(
      base({
        effects,
        messageFields,
        extraTasks:
          effects.length > 0
            ? []
            : [{ type: 'ambiguous_invoice', reason: candidates.length ? 'several_candidates' : 'no_candidate', invoiceId: null, blocksRemindersDays: 0, draft: ambiguousInvoiceDraft(tenant.name, candidates), details: { candidates } }],
        tenantEvents: effects.length > 0 ? [] : [{ type: 'ReplyAmbiguous', key: `${messageId}:ambiguous`, payload: { candidates: candidates.length } }],
      }),
    );
    await sendAlerts(deps, ev.tenantId, messageId, effects, '?');
    deps.logger.info('inbound_ambiguous', { ...mlog, count: candidates.length });
    return 'processed';
  }

  // Step 8 + 9: plan (pure) and apply (one transaction, optimistic guard, bounded re-plan).
  const invoiceId = match.invoiceIds[0] ?? '';
  for (let round = 0; round < config.maxReplans; round++) {
    const inv: InvoiceRow | null = await db.invoice(ev.tenantId, invoiceId);
    if (!inv) throw new RetryableInbound('invoice_missing');
    let effects: readonly Effect[] = [];
    const extraTasks: TaskSpec[] = [];
    if (tp.kind === 'review') {
      extraTasks.push({ type: 'human_review', reason: tp.reason, invoiceId, blocksRemindersDays: 0, draft: null, details: { intent: tp.intent } });
    } else {
      effects = planReplyOutcome({
        proposal: tp.proposal,
        invoice: { status: inv.status, balanceMinor: inv.balanceMinor, currency: inv.currency },
        reference,
        timezone: tenant.timezone,
        senderTrusted,
        statedAmount: parseStatedAmount(tp.proposal.statedAmountText, inv.currency),
        activePromise: await db.activePromise(ev.tenantId, invoiceId),
        renewalCount: await db.renewalCount(ev.tenantId, invoiceId),
        rules: { ...config.rules, promiseAcceptance: tenant.promiseAcceptance },
      }).effects;
    }
    const r = await db.applyPlan(
      base({
        invoiceId,
        expectedStatus: inv.status,
        effects,
        extraTasks,
        linkInvoiceIds: match.invoiceIds,
        drafts: { info_request: infoRequestDraft(tenant.name, inv.number, inv.referenceCode) },
        messageFields,
      }),
    );
    if (r.kind === 'status_changed') continue;
    if (r.kind === 'applied') {
      failpoints.hit('after_apply', { eventId: ev.id });
      await sendAlerts(deps, ev.tenantId, messageId, r.notify, inv.number, effects);
    }
    deps.logger.info('inbound_applied', {
      ...mlog,
      invoiceId,
      outcome: tp.kind === 'proposal' ? tp.proposal.intent : `review_${tp.reason}`,
      count: effects.length,
      reason: match.by,
    });
    return 'processed';
  }
  throw new RetryableInbound('replan_exhausted');
}

async function sendAlerts(deps: InboundDeps, tenantId: string, messageId: string, notify: readonly Effect[], invoiceNumber: string, all: readonly Effect[] = []): Promise<void> {
  for (const e of notify) {
    if (e.kind !== 'notify') continue;
    const promise = all.find((x): x is Extract<Effect, { kind: 'set_promise' }> => x.kind === 'set_promise');
    const lines = [`invoice: ${invoiceNumber}`, ...(promise ? [`promised on: ${promise.promisedOn}`] : [])];
    await alertOnce(deps, tenantId, `reply:${messageId}:${e.topic}`, e.topic, invoiceNumber, lines);
  }
}

/** One event: normalise, then message or status handling. Errors are classified for retry/dead letter. */
export async function processInboundEvent(job: ClaimedEvent, deps: InboundDeps): Promise<InboundOutcome> {
  const { db, clock, logger, config } = deps;
  const log: Log = { correlationId: `inbound:${job.eventId}`, tenantId: job.tenantId, msgId: job.msgId };
  const ev = await db.event(job.eventId);
  if (!ev) {
    await db.ack(job.msgId); // purged or never stored
    return 'missing';
  }
  if (ev.status !== 'pending') {
    await db.ack(job.msgId);
    return 'duplicate';
  }
  try {
    let outcome: InboundOutcome;
    if (ev.provider === 'whatsapp') {
      const n = normaliseWhatsApp(ev.kind, ev.payload ?? {});
      if (!n.ok) outcome = await unprocessable(deps, ev, n.error);
      else outcome = n.value.kind === 'status' ? await handleStatus(deps, ev, n.value, log) : await handleMessage(deps, ev, n.value, log);
    } else if (ev.payload?.tooLarge === true) {
      // The IMAP poller did not download it (MAX_IMAP_BYTES): a human looks at it in the mailbox.
      outcome = await unprocessable(deps, ev, 'too_large');
    } else {
      const n = await normaliseEmail(ev.rawMime ?? '');
      outcome = n.ok ? await handleMessage(deps, ev, n.message, log) : await unprocessable(deps, ev, n.error);
    }
    await db.markEventProcessed(ev.id, clock.now());
    await db.ack(job.msgId);
    return outcome;
  } catch (e) {
    if (e instanceof Error && e.name === 'FailpointCrash') throw e; // simulated process death (tests only)
    const code = e instanceof RetryableInbound ? e.code : 'processing_error';
    const attempts = await db.bumpAttempt(ev.id, code);
    if (attempts >= config.maxAttempts) {
      await db.deadLetter({ ...ev, attempts }, code, null, clock.now());
      await db.ack(job.msgId);
      logger.error('inbound_dead_lettered', { ...log, reason: code, attempt: attempts });
      return 'dead_lettered';
    }
    await db.release(job.msgId, config.retryBaseSeconds * 2 ** (attempts - 1));
    logger.warn('inbound_retry', { ...log, reason: code, attempt: attempts });
    return 'retry';
  }
}

/** Too large / unparseable / unsupported: the raw event stays (until purge) and a human sees a task. */
async function unprocessable(deps: InboundDeps, ev: InboundEventRow, error: string): Promise<InboundOutcome> {
  await deps.db.deadLetter(ev, `unprocessable_${error}`, null, deps.clock.now());
  deps.logger.warn('inbound_unprocessable', { tenantId: ev.tenantId, correlationId: `inbound:${ev.id}`, reason: error });
  return 'unprocessable';
}

export interface InboundBatchResult {
  readonly claimed: number;
  readonly outcomes: Readonly<Record<string, number>>;
}

export async function processInboundBatch(deps: InboundDeps, opts: { limit: number; filter?: Record<string, string> }): Promise<InboundBatchResult> {
  const jobs = await deps.db.claim(opts.limit, deps.config.visibilitySeconds, opts.filter ?? {});
  const outcomes: Record<string, number> = {};
  for (const job of jobs) {
    const o = await processInboundEvent(job, deps);
    outcomes[o] = (outcomes[o] ?? 0) + 1;
  }
  return { claimed: jobs.length, outcomes };
}
