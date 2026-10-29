// Receipts (prompt 5, issue K / rule 32): a transactional send. It skips decide() and approvals (the money is
// already confirmed; there is nothing to decide), and keeps every other rule of the outbox: the same
// at-most-once claim, the kill switch right before the adapter, opt-out, consent, budget, rate limit. The job
// was queued inside apply_payment's transaction, so a confirmed receipt always has exactly one job.
import { DEFAULT_TEMPLATES, appendFooter, formatAmount, isSafeAddress, messageIdFor, monthStart, render, route, sanitiseDisplayName, sanitiseHeaderValue, type OutboundEnvelope, type SendOutcome } from '@dueloop/messaging';
import { loadContext, pickTemplate, type TemplateRow, type WorkerContext } from './context.ts';
import type { ReceiptJob } from './db.ts';
import type { WorkerDeps } from './process.ts';

export type ReceiptOutcome = 'sent' | 'already_sent' | 'skipped' | 'released' | 'busy' | 'retry_scheduled' | 'failed_permanent' | 'unknown' | 'ambiguous' | 'dead_lettered';

const DEFAULT_RECEIPT_EMAIL = DEFAULT_TEMPLATES.find((t) => t.templateKey === 'receipt' && t.channel === 'email');

function receiptTemplate(c: WorkerContext, channel: 'email' | 'whatsapp'): TemplateRow | null {
  const t = pickTemplate(c.templates, 'receipt', channel, c.customer.language);
  if (t) return t;
  // Email has a built-in default; WhatsApp needs a provider-approved template, so it has none.
  if (channel === 'email' && DEFAULT_RECEIPT_EMAIL) return { templateKey: 'receipt', channel: 'email', locale: 'en', subject: DEFAULT_RECEIPT_EMAIL.subject, body: DEFAULT_RECEIPT_EMAIL.body, providerTemplateName: null, providerLanguage: null, providerStatus: null };
  return null;
}

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

async function alertOnce(deps: WorkerDeps, tenantId: string, dedupeKey: string, kind: string, title: string, lines: string[]): Promise<void> {
  if (!(await deps.db.firstNotification(tenantId, dedupeKey, 'once', kind, deps.clock.now()))) return;
  try {
    await deps.notifier.notify({ tenantId, dedupeKey, kind, severity: kind === 'message_unknown' ? 'critical' : 'warning', title, lines });
  } catch {
    deps.logger.warn('notify_failed', { tenantId, reason: kind });
  }
}

export async function processReceiptJob(job: ReceiptJob, deps: WorkerDeps): Promise<ReceiptOutcome> {
  const { db, clock, logger, config } = deps;
  const key = `receipt:${job.receiptId}`;
  const log = { correlationId: key, tenantId: job.tenantId, invoiceId: job.invoiceId, msgId: job.msgId };
  const now = clock.now();

  const loaded = await loadContext(db, job.tenantId, job.invoiceId);
  const facts = await db.receiptFacts(job.tenantId, job.receiptId);
  if (!loaded.ok || !facts) {
    await db.deadLetterReceipt(job, loaded.ok ? 'receipt_missing' : loaded.reason, job.readCount);
    logger.error('receipt_dead_lettered', { ...log, reason: loaded.ok ? 'receipt_missing' : loaded.reason });
    return 'dead_lettered';
  }
  const c = loaded.ctx;

  // At most once: an existing row for this key decides everything.
  const existing = await db.message(job.tenantId, key);
  let messageId: string | null;
  let attempt = 1;
  if (existing) {
    if (existing.sendState === 'sent') {
      await db.ackReceipt(job.msgId);
      return 'already_sent';
    }
    if (existing.sendState === 'unknown') {
      await db.ackReceipt(job.msgId);
      return 'unknown';
    }
    if (existing.sendState === 'skipped' || existing.sendState === 'failed_permanent') {
      await db.ackReceipt(job.msgId);
      return 'skipped';
    }
    if (existing.sendState === 'pending') {
      const age = now.getTime() - (existing.pendingSince?.getTime() ?? now.getTime());
      if (age < config.stalePendingSeconds * 1000) {
        await db.releaseReceipt(job.msgId, config.releaseSeconds);
        return 'busy';
      }
      await db.markReceiptUnknown(job.tenantId, job.invoiceId, existing.id, key);
      await alertOnce(deps, job.tenantId, `unknown:${key}`, 'message_unknown', `A receipt for invoice ${c.invoice.number} may or may not have been sent`, ['It will NOT be resent automatically.', 'Check it on the Unknown sends page and mark it sent or not sent (or: pnpm messages resolve <message id> --as sent|not_sent).']);
      await db.ackReceipt(job.msgId);
      return 'unknown';
    }
    // retry
    if (existing.attempt >= config.maxAttempts) {
      await db.recordReceiptFailed(existing.id, 'max_attempts');
      await db.deadLetterReceipt(job, 'max_attempts', existing.attempt);
      return 'dead_lettered';
    }
  }

  // Kill switch (rule 18): held, not dropped; it resumes when outbound is unpaused.
  const paused = await db.pausedFor(job.tenantId);
  if (paused) {
    await db.releaseReceipt(job.msgId, config.releaseSeconds);
    logger.info('receipt_gate', { ...log, gate: `paused_${paused}`, outcome: 'released' });
    return 'released';
  }

  const channel: 'email' | 'whatsapp' = c.customer.email ? 'email' : 'whatsapp';
  const skip = async (reason: string): Promise<ReceiptOutcome> => {
    await db.recordReceiptSkipped({ tenantId: job.tenantId, invoiceId: job.invoiceId, customerId: c.invoice.customerId, key, channel, reason, receiptId: job.receiptId, at: now });
    await db.ackReceipt(job.msgId);
    logger.info('receipt_gate', { ...log, gate: reason, outcome: 'skipped' });
    return 'skipped';
  };
  if (await db.customerOptedOut(c.invoice.customerId)) return skip('opted_out');

  const tmpl = receiptTemplate(c, channel);
  const spent = await db.pool.query<{ s: string }>(
    `select coalesce(sum(cost_minor), 0) as s from public.messages
     where tenant_id = $1 and direction = 'out' and send_state in ('sent', 'pending', 'unknown') and pending_since >= $2`,
    [job.tenantId, monthStart(now, c.settings.timezone)],
  );
  const r = route({
    stepChannel: channel,
    customer: { email: c.customer.email, phoneE164: c.customer.phone },
    consents: c.consents,
    accounts: [...c.accounts.keys()].filter((ch) => deps.channels.get(ch) !== undefined),
    template: { found: tmpl !== null, providerStatus: tmpl?.providerStatus ?? null },
    budgetMinor: c.tenant.budgetMinor,
    spentThisMonthMinor: Number(spent.rows[0]?.s ?? 0),
  });
  if (!r.ok || !tmpl) return skip(r.ok ? 'template_missing' : r.reason);
  const wait = deps.limiter.tryTake(`${job.tenantId}:${channel}`);
  if (wait > 0) {
    await db.releaseReceipt(job.msgId, Math.max(1, Math.ceil(wait / 1000)));
    return 'released';
  }

  // Render (pure) before the claim.
  const vars = {
    customer_name: c.customer.name,
    business_name: c.tenant.name,
    invoice_number: c.invoice.number,
    reference_code: c.invoice.referenceCode,
    amount_received: formatAmount(facts.amount, facts.currency, tmpl.locale),
    balance_remaining: formatAmount(Math.max(0, facts.balanceAfter), c.invoice.currency, tmpl.locale),
  };
  const body = render(tmpl.body, vars);
  if (!body.ok) return skip('template_render_failed');
  let envelope: OutboundEnvelope;
  let subjectText: string | null = null;
  let text = body.text;
  if (channel === 'email') {
    const subject = tmpl.subject ? render(tmpl.subject, vars) : { ok: true as const, text: '' };
    if (!subject.ok) return skip('template_render_failed');
    const account = c.accounts.get('email') ?? {};
    const fromAddress = String(account.from_address ?? '');
    const domain = String(account.message_id_domain ?? fromAddress.split('@')[1] ?? 'localhost');
    if (!c.customer.email || !isSafeAddress(c.customer.email) || !isSafeAddress(fromAddress)) return skip('unsafe_address');
    text = appendFooter(body.text, 'email', tmpl.locale);
    subjectText = sanitiseHeaderValue(subject.text);
    envelope = {
      tenantId: job.tenantId,
      idempotencyKey: key,
      account,
      content: {
        kind: 'email',
        to: { address: c.customer.email, name: sanitiseDisplayName(c.customer.name) },
        from: { address: fromAddress, name: sanitiseDisplayName(String(account.from_name ?? c.tenant.name)) },
        subject: subjectText,
        text,
        messageId: messageIdFor(key, domain),
      },
    };
  } else {
    if (!c.customer.phone || !tmpl.providerTemplateName || !tmpl.providerLanguage) return skip('template_missing');
    const parameters = Object.entries(vars)
      .filter(([k]) => tmpl.body.includes(`{{${k}}}`))
      .map(([name, value]) => ({ name, text: value }));
    envelope = { tenantId: job.tenantId, idempotencyKey: key, account: c.accounts.get('whatsapp') ?? {}, content: { kind: 'whatsapp_template', to: c.customer.phone, templateName: tmpl.providerTemplateName, languageCode: tmpl.providerLanguage, parameters } };
  }

  // Claim the key (or reclaim a retry).
  if (!existing) {
    messageId = await db.claimReceiptMessage({ tenantId: job.tenantId, invoiceId: job.invoiceId, customerId: c.invoice.customerId, channel, key, costMinor: r.cost, subject: subjectText, body: text, rfcMessageId: envelope.content.kind === 'email' ? envelope.content.messageId : null, at: now });
    if (!messageId) {
      await db.releaseReceipt(job.msgId, config.releaseSeconds);
      return 'busy';
    }
  } else {
    const re = await db.reclaimRetry(existing.id, now, text, subjectText);
    if (re === null) {
      await db.releaseReceipt(job.msgId, config.releaseSeconds);
      return 'busy';
    }
    messageId = existing.id;
    attempt = re;
  }

  await deps.failpoints.hit('after_pending_insert', { idempotencyKey: key });

  // Final gate right before the adapter: kill switch and opt-out again (rule 18).
  if ((await db.pausedFor(job.tenantId)) || (await db.customerOptedOut(c.invoice.customerId))) {
    await db.abandonClaim(messageId, 'gate_final');
    await db.releaseReceipt(job.msgId, config.releaseSeconds);
    return 'released';
  }

  const adapter = deps.channels.get(channel);
  const credentials = await db.secret(job.tenantId, channel);
  const outcome: SendOutcome = adapter ? await withTimeout(adapter.send(envelope, credentials), config.sendTimeoutMs) : { kind: 'not_sent_retryable', reason: 'no_adapter' };
  await deps.failpoints.hit('after_adapter', { idempotencyKey: key });
  const at = clock.now();
  switch (outcome.kind) {
    case 'sent':
      await db.recordReceiptSent(messageId, outcome.providerMessageId, at);
      await db.ackReceipt(job.msgId);
      logger.info('receipt_send', { ...log, outcome: 'sent', attempt });
      return 'sent';
    case 'not_sent_retryable':
      await db.recordRetry(messageId, outcome.reason);
      if (attempt >= config.maxAttempts) {
        await db.recordReceiptFailed(messageId, outcome.reason);
        await db.deadLetterReceipt(job, outcome.reason, attempt);
        return 'dead_lettered';
      }
      await db.releaseReceipt(job.msgId, config.retryBaseSeconds * 2 ** (attempt - 1));
      return 'retry_scheduled';
    case 'permanent':
      await db.recordReceiptFailed(messageId, outcome.reason);
      await db.ackReceipt(job.msgId);
      await alertOnce(deps, job.tenantId, `failed:${key}`, 'send_failed', `A receipt for invoice ${c.invoice.number} could not be sent`, [`channel: ${channel}`, `reason: ${outcome.reason}`]);
      return 'failed_permanent';
    case 'ambiguous':
      // Left pending; the stale sweep makes it unknown. Never resent automatically (rule 17).
      await db.ackReceipt(job.msgId);
      await alertOnce(deps, job.tenantId, `unknown:${key}`, 'message_unknown', `A receipt for invoice ${c.invoice.number} may or may not have been sent`, ['It will NOT be resent automatically.']);
      logger.warn('receipt_send', { ...log, outcome: 'ambiguous', reason: outcome.reason });
      return 'ambiguous';
  }
}

export async function processReceiptBatch(deps: WorkerDeps, opts: { limit: number; filter?: Record<string, string> }): Promise<{ claimed: number; outcomes: Record<string, number> }> {
  const jobs = await deps.db.claimReceipts(opts.limit, deps.config.visibilitySeconds, opts.filter ?? {});
  const outcomes: Record<string, number> = {};
  for (const job of jobs) {
    let o: string;
    try {
      o = job.kind === 'receipt' ? await processReceiptJob(job, deps) : 'unknown_kind';
      if (o === 'unknown_kind') await deps.db.deadLetterReceipt(job, 'unknown_kind', job.readCount);
    } catch (e) {
      if (e instanceof Error && e.name === 'FailpointCrash') throw e;
      o = 'error';
      deps.logger.error('receipt_error', { correlationId: `receipt:${job.receiptId}`, tenantId: job.tenantId, reason: e instanceof Error ? e.name : 'unknown' });
      if (job.readCount >= deps.config.maxAttempts * 2) await deps.db.deadLetterReceipt(job, 'repeated_errors', job.readCount);
      else await deps.db.releaseReceipt(job.msgId, deps.config.retryBaseSeconds);
    }
    outcomes[o] = (outcomes[o] ?? 0) + 1;
  }
  return { claimed: jobs.length, outcomes };
}
