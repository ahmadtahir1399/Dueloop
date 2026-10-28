import {
  DEFAULT_REPLY_RULES,
  decide as coreDecide,
  isFinal,
  planPaymentOutcome,
  planReplyOutcome,
  splitInstalments,
  transition,
  type Action,
  type Ctx,
  type InvoiceEvent,
  type Proposal,
} from '@dueloop/core';
import { DateTime } from 'luxon';
import { checkLedger, checkSends } from './checker.ts';
import type { Customer, ExternalEvent, LedgerEntry, SendRecord, SimInvoice, Tenant, TimelineEntry, Violation } from './model.ts';
import { mulberry32, type Rng } from './prng.ts';
import { generateScenario } from './scenario.ts';

export const HOUR = 3600_000;
const DAY = 24 * HOUR;

export interface SimOptions {
  readonly days: number;
  readonly invoices: number;
  readonly seed: number;
  /** UTC instant the fake clock starts at. */
  readonly start: string;
  /** Test-only faults that prove the prompt 4 and 5 invariants can fail. */
  readonly faults?: {
    readonly ignoreBlocks?: boolean;
    readonly reviveOptOuts?: boolean;
    /** Prompt 5: apply the whole amount to the invoice (no credit), ignoring the plan. */
    readonly overApply?: boolean;
    /** Prompt 5: record the money but never move the invoice to paid. */
    readonly skipPaidTransition?: boolean;
    /** Prompt 5: book one minor unit too much credit. */
    readonly unbalancedCredit?: boolean;
  };
}

export const DEFAULT_START = '2026-02-02T00:00:00Z';

export interface SimStats {
  promisesMade: number;
  promisesKept: number;
  promisesBroken: number;
  escalations: number;
  disputes: number;
  optOuts: number;
  partialPayments: number;
  overpayments: number;
  paymentsOnFinal: number;
  promisesPaidLate: number;
  externalRejected: number;
  evaluations: number;
  replyTasks: number;
  reminderBlocks: number;
  readonly remindersPerStep: Map<string, number>;
  readonly recoveredMinor: Map<string, number>;
  readonly creditMinor: Map<string, number>;
}

export interface SimResult {
  readonly options: SimOptions;
  readonly tenants: ReadonlyMap<string, Tenant>;
  readonly invoices: readonly SimInvoice[];
  readonly sends: readonly SendRecord[];
  readonly ledger: readonly LedgerEntry[];
  readonly timeline: ReadonlyMap<string, TimelineEntry[]>;
  readonly stats: SimStats;
  readonly violations: readonly Violation[];
}

export type DecideFn = (ctx: Ctx) => Action[];

/**
 * Deterministic replay: an hourly fake clock, synthetic customers, and a reducer
 * that applies decide() actions ONLY through the core state machine.
 */
export function runSimulation(options: SimOptions, decide: DecideFn = coreDecide): SimResult {
  const rng: Rng = mulberry32(options.seed);
  const start = DateTime.fromISO(options.start, { zone: 'UTC' }).toMillis();
  const end = start + options.days * DAY;
  const { tenants, customers, invoices, initialEvents } = generateScenario(rng, options.invoices, start);
  const byId = new Map(invoices.map((i) => [i.id, i]));

  const sends: SendRecord[] = [];
  const timeline = new Map<string, TimelineEntry[]>(invoices.map((i) => [i.id, [{ at: start, type: 'created', detail: `due ${i.dueOn}, ${i.total.minor} ${i.total.currency} minor` }]]));
  const engineViolations: Violation[] = [];
  const stats: SimStats = {
    promisesMade: 0,
    promisesKept: 0,
    promisesBroken: 0,
    escalations: 0,
    disputes: 0,
    optOuts: 0,
    partialPayments: 0,
    overpayments: 0,
    paymentsOnFinal: 0,
    promisesPaidLate: 0,
    externalRejected: 0,
    evaluations: 0,
    replyTasks: 0,
    reminderBlocks: 0,
    remindersPerStep: new Map(),
    recoveredMinor: new Map(),
    creditMinor: new Map(),
  };
  const ledger: LedgerEntry[] = [];
  const optOutAt = new Map<string, number>();
  let queue: ExternalEvent[] = [...initialEvents];
  let seq = initialEvents.length;

  const log = (inv: SimInvoice, at: number, type: string, detail?: string) =>
    timeline.get(inv.id)?.push(detail === undefined ? { at, type } : { at, type, detail });
  const schedule = (e: Omit<ExternalEvent, 'seq'>) => queue.push({ ...e, seq: seq++ });
  const wake = (inv: SimInvoice, at: number) => {
    if (!isFinal(inv.status)) inv.nextActionAt = at;
  };
  const tenantOf = (inv: SimInvoice): Tenant => tenants.get(inv.tenantId) as Tenant; // generated together; always present
  const customerOf = (inv: SimInvoice): Customer => customers.get(inv.customerId) as Customer; // generated together; always present

  /** The only place status changes. source 'decide' rejections are invariant violations. */
  const apply = (inv: SimInvoice, event: InvoiceEvent, at: number, source: 'decide' | 'external'): boolean => {
    const r = transition(inv.status, event);
    if (!r.ok) {
      if (source === 'decide') {
        engineViolations.push({ kind: 'illegal_transition', at, invoiceId: inv.id, detail: `${event} from ${inv.status} (${r.reason})` });
      } else {
        stats.externalRejected++;
      }
      log(inv, at, 'rejected', `${event} from ${inv.status} (${r.reason})`);
      return false;
    }
    log(inv, at, r.to, `${event}: ${r.from} -> ${r.to}`);
    inv.status = r.to;
    if (isFinal(r.to)) inv.nextActionAt = null; // cancel scheduled actions
    return true;
  };

  const react = (inv: SimInvoice, customer: Customer, at: number) => {
    const n = inv.remindersSent;
    const later = at + customer.delayHours * HOUR;
    switch (customer.behaviour) {
      case 'pays_after_reminder':
        if (n === customer.k) schedule({ at: later, kind: 'payment', invoiceId: inv.id });
        break;
      case 'overpays':
        if (n === customer.k) schedule({ at: later, kind: 'payment', invoiceId: inv.id, amountMinor: inv.total.minor - inv.paidMinor + rng.int(1, 500) });
        break;
      case 'pays_in_instalments':
        if (n === 1) {
          const parts = splitInstalments({ minor: inv.total.minor - inv.paidMinor, currency: inv.total.currency }, 2);
          if (parts.ok) {
            parts.value.forEach((p, i) => schedule({ at: later + i * 5 * DAY, kind: 'payment', invoiceId: inv.id, amountMinor: p.minor }));
          }
        }
        break;
      case 'promise_keep':
      case 'promise_break':
      case 'promise_late':
        if (n === 1) schedule({ at: later, kind: 'promise', invoiceId: inv.id, promiseDays: rng.int(2, 7) });
        break;
      case 'disputes':
        if (n === 2) schedule({ at: later, kind: 'dispute', invoiceId: inv.id });
        break;
      case 'opts_out':
        if (n === 1) schedule({ at: later, kind: 'opt_out', invoiceId: inv.id });
        break;
      case 'claims_paid':
        if (n === 1) schedule({ at: later, kind: 'payment_claim', invoiceId: inv.id });
        break;
      case 'vague_promise':
        if (n === 1) schedule({ at: later, kind: 'vague_promise', invoiceId: inv.id });
        break;
      case 'early_payer':
      case 'never_pays':
        break;
    }
  };

  /**
   * Scripted reply stage (prompt 4): a reply becomes a Proposal (no LLM) and ONLY planReplyOutcome + the state
   * machine decide what changes. Promises, disputes, payment claims and opt-outs all take this path.
   */
  const reply = (inv: SimInvoice, customer: Customer, tenant: Tenant, at: number, proposal: Proposal) => {
    const plan = planReplyOutcome({
      proposal,
      invoice: { status: inv.status, balanceMinor: inv.total.minor - inv.paidMinor, currency: inv.total.currency },
      reference: new Date(at),
      timezone: tenant.settings.timezone,
      senderTrusted: true,
      statedAmount: { kind: 'none' },
      activePromise: inv.promisedOn === undefined ? null : { promisedOn: inv.promisedOn },
      renewalCount: 0,
      rules: DEFAULT_REPLY_RULES,
    });
    for (const e of plan.effects) {
      switch (e.kind) {
        case 'transition':
          if (apply(inv, e.event, at, 'external') && e.event === 'dispute_raised') stats.disputes++;
          break;
        case 'set_promise': {
          inv.promisedOn = e.promisedOn;
          stats.promisesMade++;
          if (customer.behaviour === 'promise_keep') {
            const payAt = DateTime.fromISO(e.promisedOn, { zone: tenant.settings.timezone }).set({ hour: 12 }).toMillis();
            schedule({ at: Math.max(payAt, at + HOUR), kind: 'payment', invoiceId: inv.id });
          }
          if (customer.behaviour === 'promise_late') {
            // The first instant after promise + grace (before decide() marks it broken): real money, promise not kept.
            const payAt = DateTime.fromISO(e.promisedOn, { zone: tenant.settings.timezone }).plus({ days: tenant.policy.graceDaysAfterPromise + 1 }).startOf('day').toMillis();
            schedule({ at: payAt, kind: 'payment', invoiceId: inv.id });
          }
          wake(inv, at);
          break;
        }
        case 'create_task':
          stats.replyTasks++;
          log(inv, at, 'task', `${e.type}${e.reason ? ` (${e.reason})` : ''}`);
          if (e.blocksRemindersDays > 0) {
            inv.blockedUntil = at + e.blocksRemindersDays * DAY;
            stats.reminderBlocks++;
            log(inv, at, 'reminders_blocked', `${e.blocksRemindersDays} days`);
          }
          break;
        case 'record_opt_out':
          if (customer.optedOut) break;
          customer.optedOut = true;
          optOutAt.set(customer.id, at);
          stats.optOuts++;
          for (const other of invoices) {
            if (other.customerId !== customer.id) continue;
            log(other, at, 'opted_out', `customer ${customer.id}`);
            wake(other, at);
          }
          if (options.faults?.reviveOptOuts) schedule({ at: at + 10 * DAY, kind: 'opt_out', invoiceId: inv.id, promiseDays: -1 });
          break;
        case 'notify':
          break;
      }
    }
  };
  const proposal = (intent: Proposal['intent'], over: Partial<Proposal> = {}): Proposal => ({ intent, confidence: 0.95, promisedDate: null, dateIsVague: false, statedAmountText: null, ...over });

  const handleExternal = (e: ExternalEvent, at: number) => {
    const inv = byId.get(e.invoiceId);
    if (!inv) return;
    const customer = customerOf(inv);
    const tenant = tenantOf(inv);
    switch (e.kind) {
      case 'payment': {
        // Prompt 5 payment stage: the pure plan decides applied/credit/transition; nothing else does.
        const balance = inv.total.minor - inv.paidMinor;
        const amount = e.amountMinor ?? balance;
        if (amount <= 0) return; // nothing left to pay (an instalment after the invoice closed)
        const plan = planPaymentOutcome({
          invoice: { status: inv.status, balanceMinor: balance, currency: inv.total.currency },
          receipt: { amountMinor: amount, currency: inv.total.currency },
          promise: inv.promisedOn === undefined ? null : { promisedOn: inv.promisedOn },
          paidAt: new Date(at),
          timezone: tenant.settings.timezone,
          graceDays: tenant.policy.graceDaysAfterPromise,
        });
        if (plan.rejected) {
          log(inv, at, 'payment_rejected', plan.rejected);
          return;
        }
        const applied = options.faults?.overApply ? amount : plan.applied;
        const credit = options.faults?.overApply ? 0 : plan.credit + (options.faults?.unbalancedCredit ? 1 : 0);
        ledger.push({ at, invoiceId: inv.id, currency: inv.total.currency, received: amount, applied, credit });
        inv.paidMinor += applied;
        stats.recoveredMinor.set(inv.total.currency, (stats.recoveredMinor.get(inv.total.currency) ?? 0) + applied);
        if (credit > 0) {
          stats.creditMinor.set(inv.total.currency, (stats.creditMinor.get(inv.total.currency) ?? 0) + credit);
          if (applied > 0) stats.overpayments++;
          else stats.paymentsOnFinal++;
          log(inv, at, 'credit', `${credit} minor`);
        }
        if (plan.promiseOutcome === 'kept') stats.promisesKept++;
        if (plan.promiseOutcome === 'not_kept') stats.promisesPaidLate++;
        if (applied === 0) return;
        if (!plan.transition) {
          stats.partialPayments++;
          log(inv, at, 'partial_payment', `${applied} minor, balance ${inv.total.minor - inv.paidMinor}`);
          return;
        }
        log(inv, at, 'payment_confirmed', `${applied} minor`);
        if (!options.faults?.skipPaidTransition) apply(inv, 'balance_reached_zero', at, 'external');
        if (plan.promiseOutcome !== 'none') inv.promisedOn = undefined;
        return;
      }
      case 'promise': {
        const promisedOn = DateTime.fromMillis(at, { zone: tenant.settings.timezone })
          .plus({ days: e.promiseDays ?? 3 })
          .toFormat('yyyy-MM-dd');
        log(inv, at, 'reply', `promise to pay on ${promisedOn}`);
        reply(inv, customer, tenant, at, proposal('promise_to_pay', { promisedDate: promisedOn }));
        return;
      }
      case 'vague_promise':
        log(inv, at, 'reply', 'vague promise');
        reply(inv, customer, tenant, at, proposal('promise_to_pay', { dateIsVague: true }));
        return;
      case 'payment_claim':
        log(inv, at, 'reply', 'already paid');
        reply(inv, customer, tenant, at, proposal('already_paid'));
        return;
      case 'dispute':
        log(inv, at, 'reply', 'dispute');
        reply(inv, customer, tenant, at, proposal('dispute'));
        return;
      case 'opt_out':
        if (e.promiseDays === -1) {
          // Fault injection only (faults.reviveOptOuts): the bug "opt-out is not final".
          customer.optedOut = false;
          wake(inv, at);
          return;
        }
        log(inv, at, 'reply', 'stop');
        reply(inv, customer, tenant, at, proposal('opt_out'));
        return;
      case 'write_off':
        apply(inv, 'written_off', at, 'external');
        return;
      case 'void':
        apply(inv, 'voided', at, 'external');
        return;
    }
  };

  const evaluate = (inv: SimInvoice, at: number) => {
    const tenant = tenantOf(inv);
    const customer = customerOf(inv);
    // The worker's pre-decide gate (prompt 4): an unexpired block => wait for it, send nothing.
    if (inv.blockedUntil !== null && at < inv.blockedUntil && !options.faults?.ignoreBlocks) {
      inv.nextActionAt = inv.blockedUntil;
      return;
    }
    const ctx: Ctx = {
      now: new Date(at),
      invoice: {
        id: inv.id,
        status: inv.status,
        dueOn: inv.dueOn,
        ...(inv.promisedOn === undefined ? {} : { promisedOn: inv.promisedOn }),
      },
      customer: { optedOut: customer.optedOut },
      // sentAt is customer-wide so the weekly cap protects the person, not the invoice.
      history: { sentStepIds: [...inv.sentStepIds], sentAt: customer.sentAt.map((t) => new Date(t)), escalated: inv.escalated },
      policy: tenant.policy,
      settings: tenant.settings,
    };
    stats.evaluations++;
    const actions = decide(ctx);
    let waited = false;
    for (const a of actions) {
      switch (a.kind) {
        case 'mark_overdue':
          apply(inv, 'due_date_passed', at, 'decide');
          break;
        case 'mark_promise_broken':
          if (apply(inv, 'promise_broken', at, 'decide')) {
            stats.promisesBroken++;
            inv.promisedOn = undefined;
          }
          break;
        case 'escalate':
          if (apply(inv, 'escalation_triggered', at, 'decide')) {
            inv.escalated = true;
            stats.escalations++;
            log(inv, at, 'owner_notified', a.reason);
            if (rng.chance(0.5)) schedule({ at: at + 14 * DAY, kind: 'write_off', invoiceId: inv.id });
          }
          break;
        case 'send_reminder': {
          sends.push({
            at,
            tenantId: inv.tenantId,
            customerId: inv.customerId,
            invoiceId: inv.id,
            stepId: a.step.id,
            channel: a.step.channel,
            idempotencyKey: a.idempotencyKey,
            statusAtSend: inv.status,
            optedOutAtSend: customer.optedOut,
            promisedOnAtSend: inv.promisedOn,
            blockedUntilAtSend: inv.blockedUntil,
          });
          if (!inv.sentStepIds.includes(a.step.id)) inv.sentStepIds.push(a.step.id);
          customer.sentAt.push(at);
          inv.remindersSent++;
          stats.remindersPerStep.set(a.step.id, (stats.remindersPerStep.get(a.step.id) ?? 0) + 1);
          log(inv, at, 'reminder_sent', `${a.step.id} via ${a.step.channel}, key ${a.idempotencyKey}`);
          react(inv, customer, at);
          break;
        }
        case 'wait_until':
          waited = true;
          inv.nextActionAt = a.at.getTime();
          log(inv, at, 'wait_until', DateTime.fromJSDate(a.at, { zone: 'UTC' }).toISO() ?? '');
          break;
      }
    }
    if (isFinal(inv.status)) inv.nextActionAt = null;
    // No wake-up requested: re-check next hour if something happened, else daily (see 5h).
    else if (!waited) inv.nextActionAt = at + (actions.length > 0 ? HOUR : DAY);
  };

  for (let t = start; t < end; t += HOUR) {
    const due = queue.filter((e) => e.at <= t).sort((a, b) => a.at - b.at || a.seq - b.seq);
    if (due.length > 0) {
      queue = queue.filter((e) => e.at > t);
      for (const e of due) handleExternal(e, t);
    }
    for (const inv of invoices) {
      if (inv.nextActionAt !== null && inv.nextActionAt <= t) evaluate(inv, t);
    }
  }

  const violations = [...engineViolations, ...checkSends(sends, tenants, optOutAt), ...checkLedger(ledger, invoices, sends)].sort(
    (a, b) => a.at - b.at || (a.invoiceId < b.invoiceId ? -1 : a.invoiceId > b.invoiceId ? 1 : 0) || (a.kind < b.kind ? -1 : 1),
  );
  return { options, tenants, invoices, sends, ledger, timeline, stats, violations };
}
