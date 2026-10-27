// The send protocol (ADR 0013), one job = one invoice. Write the envelope in the mail log BEFORE walking to
// the post box: a crash at any point leaves either nothing, a pending row (-> unknown, never resent), or a
// recorded outcome. decide() is re-run on every job, approvals included (rule 16); the kill switch is checked
// right before every send (rule 18).
import { decide, nextSendWindow, transition, type Action, type InvoiceEvent } from '@dueloop/core';
import {
  SKIP_REASONS,
  appendFooter,
  formatAmount,
  formatDueDate,
  isSafeAddress,
  messageIdFor,
  monthStart,
  placeholders,
  render,
  route,
  sanitiseDisplayName,
  sanitiseHeaderValue,
  jitterMinutes,
  type Alert,
  type OutboundEnvelope,
  type SendOutcome,
} from '@dueloop/messaging';
import { DateTime } from 'luxon';
import { loadContext, pickTemplate, toCtx, type WorkerContext } from './context.ts';
import type { Job, WorkerDb } from './db.ts';
import type { Logger } from './logger.ts';
import type { ChannelRegistry, Clock, Failpoints, Notifier, RateLimiter, WorkerConfig } from './ports.ts';

export interface WorkerDeps {
  readonly db: WorkerDb;
  readonly clock: Clock;
  readonly channels: ChannelRegistry;
  readonly notifier: Notifier;
  readonly limiter: RateLimiter;
  readonly logger: Logger;
  readonly failpoints: Failpoints;
  readonly config: WorkerConfig;
}

export type JobOutcome =
  | 'sent'
  | 'waiting'
  | 'no_action'
  | 'approval_requested'
  | 'parked'
  | 'skipped'
  | 'released'
  | 'busy'
  | 'retry_scheduled'
  | 'failed_permanent'
  | 'ambiguous'
  | 'unknown'
  | 'dead_lettered'
  | 'already_sent';

const MINUTE = 60_000;
const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);

/** Rule D: after any send, the next action is the start of the NEXT local day's send window (+ jitter). */
export function nextActionAfterSend(now: Date, ctx: WorkerContext, jitterWindow: number): Date {
  const tomorrow = DateTime.fromJSDate(now).setZone(ctx.settings.timezone).plus({ days: 1 }).startOf('day');
  const win = nextSendWindow(tomorrow, ctx.settings);
  const base = win.ok ? win.at.toJSDate() : addMs(now, 24 * 60 * MINUTE);
  return addMs(base, jitterMinutes(ctx.invoice.id, jitterWindow) * MINUTE);
}

/** wait_until + deterministic forward jitter, so the end of quiet hours does not fire everything at once. */
export function withJitter(at: Date, invoiceId: string, jitterWindow: number): Date {
  return addMs(at, jitterMinutes(invoiceId, jitterWindow) * MINUTE);
}

async function alertOnce(deps: WorkerDeps, alert: Alert, period: string): Promise<void> {
  const first = await deps.db.firstNotification(alert.tenantId, alert.dedupeKey, period, alert.kind, deps.clock.now());
  if (!first) return;
  try {
    await deps.notifier.notify(alert);
  } catch {
    deps.logger.warn('notify_failed', { tenantId: alert.tenantId, reason: alert.kind }); // never fails the job
  }
}

const dayPeriod = (d: Date) => d.toISOString().slice(0, 10);

async function withTimeout(p: Promise<SendOutcome>, ms: number): Promise<SendOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SendOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'ambiguous', reason: 'adapter_timeout' }), ms);
  });
  try {
    return await Promise.race([p.catch((): SendOutcome => ({ kind: 'ambiguous', reason: 'adapter_threw' })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Content = { ok: true; envelope: OutboundEnvelope; subject: string | null; body: string } | { ok: false; reason: string };

function buildContent(c: WorkerContext, key: string, stepTemplate: string, channel: 'email' | 'whatsapp' | 'sms', now: Date, overrides: { subject: string | null; body: string | null }): Content {
  const tmpl = pickTemplate(c.templates, stepTemplate, channel, c.customer.language);
  if (!tmpl) return { ok: false, reason: 'template_missing' };
  const locale = c.customer.language;
  const daysLate = Math.max(
    0,
    Math.round(
      DateTime.fromJSDate(now).setZone(c.settings.timezone).startOf('day').diff(DateTime.fromISO(c.invoice.dueOn, { zone: c.settings.timezone }).startOf('day'), 'days').days,
    ),
  );
  const vars = {
    customer_name: c.customer.name,
    business_name: c.tenant.name,
    invoice_number: c.invoice.number,
    amount_due: formatAmount(c.invoice.balanceMinor, c.invoice.currency, locale),
    due_date: formatDueDate(c.invoice.dueOn, locale),
    days_overdue: String(daysLate),
    reference_code: c.invoice.referenceCode,
    bank_instructions: c.tenant.bankInstructions,
    pay_link: '', // payment links arrive in prompt 5; the variable exists and is empty
  };
  const body = render(tmpl.body, vars);
  if (!body.ok) return { ok: false, reason: 'template_render_failed' };

  if (channel === 'email') {
    const subject = tmpl.subject ? render(tmpl.subject, vars) : { ok: true as const, text: '' };
    if (!subject.ok) return { ok: false, reason: 'template_render_failed' };
    const account = c.accounts.get('email') ?? {};
    const fromAddress = String(account.from_address ?? '');
    const domain = String(account.message_id_domain ?? fromAddress.split('@')[1] ?? 'localhost');
    if (!c.customer.email || !isSafeAddress(c.customer.email) || !isSafeAddress(fromAddress)) return { ok: false, reason: 'unsafe_address' };
    // The footer goes on AFTER rendering and after any human edit, so an edit can never remove it.
    const text = appendFooter(overrides.body ?? body.text, 'email', locale);
    const subjectText = sanitiseHeaderValue(overrides.subject ?? subject.text);
    return {
      ok: true,
      subject: subjectText,
      body: text,
      envelope: {
        tenantId: c.invoice.tenantId,
        idempotencyKey: key,
        content: {
          kind: 'email',
          to: { address: c.customer.email, name: sanitiseDisplayName(c.customer.name) },
          from: { address: fromAddress, name: sanitiseDisplayName(String(account.from_name ?? c.tenant.name)) },
          subject: subjectText,
          text,
          messageId: messageIdFor(key, domain),
        },
      },
    };
  }
  if (channel === 'whatsapp') {
    if (!c.customer.phone || !tmpl.providerTemplateName || !tmpl.providerLanguage) return { ok: false, reason: 'template_missing' };
    const parameters = placeholders(tmpl.body).map((name) => ({ name, text: vars[name as keyof typeof vars] ?? '' }));
    return {
      ok: true,
      subject: null,
      // WhatsApp sends a pre-approved template; its opt-out wording must be part of that approved template.
      body: body.text,
      envelope: {
        tenantId: c.invoice.tenantId,
        idempotencyKey: key,
        content: { kind: 'whatsapp_template', to: c.customer.phone, templateName: tmpl.providerTemplateName, languageCode: tmpl.providerLanguage, parameters },
      },
    };
  }
  return { ok: false, reason: 'channel_unsupported' };
}

const requiresApproval = (mode: string) => mode !== 'never'; // 'low_confidence' = 'always' until prompt 4 (ADR 0015)

export async function processJob(job: Job, deps: WorkerDeps): Promise<JobOutcome> {
  const { db, clock, logger, failpoints, config } = deps;
  const log = { correlationId: `${job.invoiceId}:${job.msgId}`, tenantId: job.tenantId, invoiceId: job.invoiceId, msgId: job.msgId };
  failpoints.hit('after_claim', { idempotencyKey: null });

  for (let round = 0; round < 3; round++) {
    const loaded = await loadContext(db, job.tenantId, job.invoiceId);
    if (!loaded.ok) {
      await db.setNextAction(job.tenantId, job.invoiceId, 'infinity', loaded.reason);
      await alertOnce(deps, { tenantId: job.tenantId, dedupeKey: `park:${job.invoiceId}:${loaded.reason}`, kind: 'parked', severity: 'warning', title: 'An invoice needs attention', lines: [`reason: ${loaded.reason}`] }, 'once');
      await db.ack(job.msgId);
      logger.warn('job_parked', { ...log, reason: loaded.reason });
      return 'parked';
    }
    const c = loaded.ctx;
    const now = clock.now();
    const actions = decide(toCtx(c, now));
    const send = actions.find((a): a is Extract<Action, { kind: 'send_reminder' }> => a.kind === 'send_reminder');

    // An approval authorises one key only; anything decide() no longer proposes is superseded (rule 16).
    await db.supersedeApprovals(job.tenantId, job.invoiceId, send?.idempotencyKey ?? null, send ? 'decide_proposes_other_step' : 'decide_proposes_no_send', now);

    // State changes through the core state machine + an optimistic DB guard.
    let status = c.invoice.status;
    let moved = false;
    for (const a of actions) {
      let event: InvoiceEvent | null = null;
      let spec: { type: string; key: string } | null = null;
      if (a.kind === 'mark_overdue') {
        event = 'due_date_passed';
        spec = { type: 'InvoiceOverdue', key: `overdue:${c.invoice.id}` };
      } else if (a.kind === 'mark_promise_broken') {
        event = 'promise_broken';
        spec = { type: 'PromiseBroken', key: `promise-broken:${c.invoice.id}:${c.invoice.promisedOn ?? ''}` };
      } else if (a.kind === 'escalate') {
        event = 'escalation_triggered';
        spec = { type: 'InvoiceEscalated', key: `escalated:${c.invoice.id}` };
      }
      if (!event || !spec) continue;
      const t = transition(status as Parameters<typeof transition>[0], event);
      if (!t.ok) {
        logger.error('illegal_transition_proposed', { ...log, reason: `${status}:${event}` });
        continue;
      }
      const ok = await db.transition(job.tenantId, job.invoiceId, status, t.to, { ...spec, payload: { from: status, to: t.to, reason: a.kind === 'escalate' ? a.reason : event } });
      if (!ok) {
        moved = true; // someone else moved it: reload and decide again
        break;
      }
      status = t.to;
      if (a.kind === 'escalate') {
        await alertOnce(
          deps,
          {
            tenantId: job.tenantId,
            dedupeKey: `escalated:${c.invoice.id}`,
            kind: 'escalated',
            severity: 'warning',
            title: `Invoice ${c.invoice.number} escalated`,
            lines: [`customer: ${c.customer.name}`, `balance: ${formatAmount(c.invoice.balanceMinor, c.invoice.currency, 'en')}`, `reason: ${a.reason}`, `reminders sent: ${c.sentStepIds.length}`],
          },
          'once',
        );
      }
    }
    if (moved) continue;

    if (!send) {
      const wait = actions.find((a): a is Extract<Action, { kind: 'wait_until' }> => a.kind === 'wait_until');
      // No wake-up from decide() (e.g. sequence done, below the escalation threshold): re-check daily.
      const next = wait ? withJitter(wait.at, c.invoice.id, config.jitterMinutes) : addMs(now, 24 * 60 * MINUTE);
      await db.setNextAction(job.tenantId, job.invoiceId, next, null);
      await db.ack(job.msgId);
      logger.info('job_done', { ...log, outcome: wait ? 'waiting' : 'no_action', count: actions.length });
      return wait ? 'waiting' : 'no_action';
    }
    return sendPath(job, c, send, deps, log);
  }
  await db.release(job.msgId, 5);
  logger.warn('job_contended', log);
  return 'busy';
}

async function sendPath(
  job: Job,
  c: WorkerContext,
  action: Extract<Action, { kind: 'send_reminder' }>,
  deps: WorkerDeps,
  baseLog: { correlationId: string; tenantId: string; invoiceId: string; msgId: number },
): Promise<JobOutcome> {
  const { db, clock, logger, failpoints, config } = deps;
  const key = action.idempotencyKey;
  const step = action.step;
  const channel = step.channel;
  const log = { ...baseLog, stepId: step.id, channel };
  const now = clock.now();

  // Gate 1: kill switch (tenant AND global), checked at send time (issue F, rule 18).
  const paused = await db.pausedFor(job.tenantId);
  if (paused) {
    await db.release(job.msgId, config.releaseSeconds);
    logger.info('send_gate', { ...log, gate: `paused_${paused}`, outcome: 'released' });
    return 'released';
  }
  // Gate 2: opted out since the context was loaded -> abort; decide() handles it on the next run.
  if (await db.customerOptedOut(c.invoice.customerId)) {
    await db.setNextAction(job.tenantId, job.invoiceId, now, null);
    await db.ack(job.msgId);
    logger.info('send_gate', { ...log, gate: 'opted_out', outcome: 'no_action' });
    return 'no_action';
  }
  // Gate 3: router (contact, consent, budget, template, account). No fallback channel.
  const spent = await db.pool.query<{ s: string }>(
    `select coalesce(sum(cost_minor), 0) as s from public.messages
     where tenant_id = $1 and direction = 'out' and send_state in ('sent', 'pending', 'unknown') and pending_since >= $2`,
    [job.tenantId, monthStart(now, c.settings.timezone)],
  );
  const tmpl = pickTemplate(c.templates, step.templateKey, channel, c.customer.language);
  const r = route({
    stepChannel: channel,
    customer: { email: c.customer.email, phoneE164: c.customer.phone },
    consents: c.consents,
    accounts: [...c.accounts.keys()].filter((ch) => deps.channels.get(ch) !== undefined),
    template: { found: tmpl !== null, providerStatus: tmpl?.providerStatus ?? null },
    budgetMinor: c.tenant.budgetMinor,
    spentThisMonthMinor: Number(spent.rows[0]?.s ?? 0),
  });
  if (!r.ok) {
    if (SKIP_REASONS.includes(r.reason)) {
      await db.recordSkip({ tenantId: job.tenantId, invoiceId: job.invoiceId, customerId: c.invoice.customerId, key, stepId: step.id, channel, reason: r.reason, at: now });
      await db.ack(job.msgId);
      logger.info('send_gate', { ...log, gate: r.reason, outcome: 'skipped' });
      return 'skipped';
    }
    return park(job, deps, log, c, key, r.reason);
  }
  // Gate 4: rate limiter (per tenant + channel).
  const wait = deps.limiter.tryTake(`${job.tenantId}:${channel}`);
  if (wait > 0) {
    await db.release(job.msgId, Math.max(1, Math.ceil(wait / 1000)));
    logger.info('send_gate', { ...log, gate: 'rate_limited', outcome: 'released' });
    return 'released';
  }

  // Step 4: approval for exactly this key.
  let overrides = { subject: null as string | null, body: null as string | null };
  if (requiresApproval(c.tenant.approvalMode)) {
    const a = await db.approvalFor(job.tenantId, key);
    if (!a || a.status === 'expired' || a.status === 'superseded') {
      await db.requestApproval(job.tenantId, job.invoiceId, key, step.id, channel, now);
      await alertOnce(deps, { tenantId: job.tenantId, dedupeKey: 'approvals_waiting', kind: 'approvals_waiting', severity: 'info', title: 'Reminders are waiting for approval', lines: ['Run: pnpm approvals list'] }, dayPeriod(now));
      await db.ack(job.msgId);
      logger.info('approval', { ...log, outcome: 'requested' });
      return 'approval_requested';
    }
    if (a.status === 'pending') {
      await db.setNextAction(job.tenantId, job.invoiceId, 'infinity', 'awaiting_approval');
      await db.ack(job.msgId);
      return 'approval_requested';
    }
    if (a.status === 'rejected') {
      await db.setNextAction(job.tenantId, job.invoiceId, now, null); // the skipped step is already recorded
      await db.ack(job.msgId);
      return 'skipped';
    }
    overrides = { subject: a.subjectOverride, body: a.bodyOverride };
  }

  // Render BEFORE the claim (pure): a template problem can never leave a pending row behind.
  const content = buildContent(c, key, step.templateKey, channel, now, overrides);
  if (!content.ok) {
    if (content.reason === 'unsafe_address') {
      await db.recordSkip({ tenantId: job.tenantId, invoiceId: job.invoiceId, customerId: c.invoice.customerId, key, stepId: step.id, channel, reason: 'unsafe_address', at: now });
      await db.ack(job.msgId);
      return 'skipped';
    }
    return park(job, deps, log, c, key, content.reason);
  }

  // Step 5: claim the key in the outbox.
  let messageId: string | null = null;
  let attempt = 1;
  const existing = await db.message(job.tenantId, key);
  if (!existing) {
    messageId = await db.claimMessage({
      tenantId: job.tenantId,
      invoiceId: job.invoiceId,
      customerId: c.invoice.customerId,
      channel,
      key,
      stepId: step.id,
      templateKey: step.templateKey,
      costMinor: r.cost,
      subject: content.subject,
      body: content.body,
      rfcMessageId: content.envelope.content.kind === 'email' ? content.envelope.content.messageId : null,
      at: now,
    });
  }
  if (!messageId) {
    const m = existing ?? (await db.message(job.tenantId, key));
    if (!m) {
      await db.release(job.msgId, config.releaseSeconds);
      return 'busy';
    }
    if (m.sendState === 'sent') {
      // Crash after recording, before ack: bookkeeping only, idempotently. No send.
      await db.recordSent({ tenantId: job.tenantId, invoiceId: job.invoiceId, messageId: m.id, key, stepId: step.id, channel, providerMessageId: null, at: now, nextActionAt: nextActionAfterSend(now, c, config.jitterMinutes) });
      await db.ack(job.msgId);
      logger.info('send', { ...log, outcome: 'already_sent' });
      return 'already_sent';
    }
    if (m.sendState === 'pending') {
      const age = now.getTime() - (m.pendingSince?.getTime() ?? now.getTime());
      if (age < config.stalePendingSeconds * 1000) {
        await db.release(job.msgId, config.releaseSeconds); // another worker is active on this key
        logger.info('send', { ...log, outcome: 'busy' });
        return 'busy';
      }
      await db.markUnknown(job.tenantId, job.invoiceId, m.id, key);
      await alertUnknown(deps, job.tenantId, c.invoice.number, key);
      await db.ack(job.msgId);
      logger.warn('send', { ...log, outcome: 'unknown' });
      return 'unknown';
    }
    if (m.sendState === 'unknown') {
      await db.setNextAction(job.tenantId, job.invoiceId, 'infinity', 'message_unknown');
      await db.ack(job.msgId);
      return 'unknown';
    }
    if (m.sendState === 'failed_permanent' || m.sendState === 'skipped') {
      await db.setNextAction(job.tenantId, job.invoiceId, now, null);
      await db.ack(job.msgId);
      return 'skipped';
    }
    // retry
    if (m.attempt >= config.maxAttempts) {
      await deadLetter(job, deps, log, c, key, m.attempt, 'max_attempts');
      return 'dead_lettered';
    }
    const reclaimed = await db.reclaimRetry(m.id, now, content.body, content.subject);
    if (reclaimed === null) {
      await db.release(job.msgId, config.releaseSeconds);
      return 'busy';
    }
    messageId = m.id;
    attempt = reclaimed;
  }
  failpoints.hit('after_pending_insert', { idempotencyKey: key });

  // Step 7: the adapter, with a hard timeout. A timeout is AMBIGUOUS (issue K), never a retryable failure.
  const adapter = deps.channels.get(channel);
  const credentials = await db.secret(job.tenantId, channel);
  const outcome: SendOutcome = adapter
    ? await withTimeout(adapter.send(content.envelope, credentials), config.sendTimeoutMs)
    : { kind: 'not_sent_retryable', reason: 'no_adapter' };
  failpoints.hit('after_adapter', { idempotencyKey: key });
  const at = clock.now();

  // Step 8: record the outcome in one transaction; step 9: ack last.
  switch (outcome.kind) {
    case 'sent': {
      await db.recordSent({ tenantId: job.tenantId, invoiceId: job.invoiceId, messageId, key, stepId: step.id, channel, providerMessageId: outcome.providerMessageId, at, nextActionAt: nextActionAfterSend(at, c, config.jitterMinutes) });
      failpoints.hit('after_record', { idempotencyKey: key });
      await db.ack(job.msgId);
      logger.info('send', { ...log, outcome: 'sent', attempt });
      return 'sent';
    }
    case 'not_sent_retryable': {
      await db.recordRetry(messageId, outcome.reason);
      failpoints.hit('after_record', { idempotencyKey: key });
      if (attempt >= config.maxAttempts) {
        await deadLetter(job, deps, log, c, key, attempt, outcome.reason);
        return 'dead_lettered';
      }
      await db.release(job.msgId, config.retryBaseSeconds * 2 ** (attempt - 1));
      logger.warn('send', { ...log, outcome: 'retry_scheduled', reason: outcome.reason, attempt });
      return 'retry_scheduled';
    }
    case 'permanent': {
      await db.recordPermanent({ tenantId: job.tenantId, invoiceId: job.invoiceId, messageId, key, stepId: step.id, channel, reason: outcome.reason, at });
      failpoints.hit('after_record', { idempotencyKey: key });
      await alertOnce(deps, { tenantId: job.tenantId, dedupeKey: `failed:${key}`, kind: 'send_failed', severity: 'warning', title: `A reminder for invoice ${c.invoice.number} could not be sent`, lines: [`channel: ${channel}`, `reason: ${outcome.reason}`] }, 'once');
      await db.ack(job.msgId);
      logger.warn('send', { ...log, outcome: 'failed_permanent', reason: outcome.reason });
      return 'failed_permanent';
    }
    case 'ambiguous': {
      // Leave the row pending; the stale sweep turns it into 'unknown'. Park so nothing retries it.
      await db.setNextAction(job.tenantId, job.invoiceId, 'infinity', 'send_ambiguous');
      await alertUnknown(deps, job.tenantId, c.invoice.number, key);
      await db.ack(job.msgId);
      logger.warn('send', { ...log, outcome: 'ambiguous', reason: outcome.reason });
      return 'ambiguous';
    }
  }
}

async function park(job: Job, deps: WorkerDeps, log: Record<string, string | number>, c: WorkerContext, key: string, reason: string): Promise<JobOutcome> {
  await deps.db.setNextAction(job.tenantId, job.invoiceId, 'infinity', reason, { type: 'ReminderParked', key: `${key}:parked:${reason}`, payload: { reason } });
  await alertOnce(
    deps,
    { tenantId: job.tenantId, dedupeKey: `park:${job.invoiceId}:${reason}`, kind: 'parked', severity: 'warning', title: `Reminders for invoice ${c.invoice.number} are on hold`, lines: [`reason: ${reason}`, 'Fix it, then: pnpm messages unpark --invoice <id>'] },
    'once',
  );
  await deps.db.ack(job.msgId);
  deps.logger.warn('send_gate', { ...log, gate: reason, outcome: 'parked' });
  return 'parked';
}

async function alertUnknown(deps: WorkerDeps, tenantId: string, invoiceNumber: string, key: string): Promise<void> {
  await alertOnce(
    deps,
    { tenantId, dedupeKey: `unknown:${key}`, kind: 'message_unknown', severity: 'critical', title: `A reminder for invoice ${invoiceNumber} may or may not have been sent`, lines: ['It will NOT be resent automatically.', 'Check, then: pnpm messages resolve --id <message id> --as sent|not_sent'] },
    'once',
  );
}

async function deadLetter(job: Job, deps: WorkerDeps, log: Record<string, string | number>, c: WorkerContext, key: string, attempts: number, reason: string): Promise<void> {
  await deps.db.deadLetter(job.msgId, reason, attempts);
  await alertOnce(deps, { tenantId: job.tenantId, dedupeKey: `dead:${key}`, kind: 'dead_letter', severity: 'critical', title: `Reminder for invoice ${c.invoice.number} failed ${attempts} times`, lines: [`reason: ${reason}`] }, 'once');
  deps.logger.error('dead_letter', { ...log, reason, attempt: attempts });
}

/**
 * Human reconciliation of an 'unknown' message. as=sent counts as a send made then (rule D: the next action
 * is the next local day's window); as=not_sent re-opens the step for the same key. Never sends by itself.
 */
export async function reconcileMessage(deps: WorkerDeps, messageId: string, as: 'sent' | 'not_sent'): Promise<boolean> {
  const now = deps.clock.now();
  const link = await deps.db.messageInvoice(messageId);
  if (!link) return false;
  let next = now;
  if (as === 'sent') {
    const loaded = await loadContext(deps.db, link.tenantId, link.invoiceId);
    next = loaded.ok ? nextActionAfterSend(now, loaded.ctx, deps.config.jitterMinutes) : addMs(now, 24 * 60 * MINUTE);
  }
  const ok = await deps.db.resolveUnknown(messageId, as, next);
  if (ok) deps.logger.info('reconciled', { tenantId: link.tenantId, invoiceId: link.invoiceId, messageId, outcome: as });
  return ok;
}

/** Stale sweep + approval expiry (also scheduled by cron). Alerts for every message that became unknown. */
export async function sweep(deps: WorkerDeps): Promise<{ unknown: number; expired: number }> {
  const now = deps.clock.now();
  const stale = await deps.db.sweepStale(deps.config.stalePendingSeconds, now);
  for (const s of stale) {
    const n = await deps.db.pool.query<{ number: string; idempotency_key: string }>(
      'select i.number, m.idempotency_key from public.invoices i, public.messages m where i.id = $1 and m.id = $2',
      [s.invoiceId, s.messageId],
    );
    const row = n.rows[0];
    if (row) await alertUnknown(deps, s.tenantId, row.number, row.idempotency_key);
  }
  const expired = await deps.db.expireApprovals(deps.config.approvalMaxAgeDays, now);
  if (stale.length || expired) deps.logger.info('sweep', { count: stale.length, outcome: `expired_${expired}` });
  return { unknown: stale.length, expired };
}

export interface BatchResult {
  readonly claimed: number;
  readonly outcomes: Readonly<Record<string, number>>;
}

/** Claims up to `limit` jobs and processes them one by one. A crash (or test failpoint) propagates. */
export async function processBatch(deps: WorkerDeps, opts: { limit: number; filter?: Record<string, string> }): Promise<BatchResult> {
  const jobs = await deps.db.claim(opts.limit, deps.config.visibilitySeconds, opts.filter ?? {});
  const outcomes: Record<string, number> = {};
  for (const job of jobs) {
    let outcome: string;
    try {
      outcome = await processJob(job, deps);
    } catch (e) {
      if (e instanceof Error && e.name === 'FailpointCrash') throw e; // simulated process death (tests only)
      outcome = 'error';
      deps.logger.error('job_error', { correlationId: `${job.invoiceId}:${job.msgId}`, tenantId: job.tenantId, invoiceId: job.invoiceId, reason: e instanceof Error ? e.name : 'unknown' });
      if (job.readCount >= deps.config.maxAttempts * 2) await deps.db.deadLetter(job.msgId, 'repeated_errors', job.readCount);
      else await deps.db.release(job.msgId, deps.config.retryBaseSeconds);
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { claimed: jobs.length, outcomes };
}
