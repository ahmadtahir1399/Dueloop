import { DateTime } from 'luxon';
import { NO_CONTACT_STATUSES, type Action, type Ctx } from './domain/types.ts';
import { nextSendWindow } from './time.ts';

/** The idempotency key for one reminder: at most one send per (invoice, step, channel). */
export function reminderKey(invoiceId: string, stepId: string, channel: string): string {
  return `${invoiceId}:${stepId}:${channel}`;
}

/**
 * Pure function: no I/O, no clocks, no randomness. Same inputs, same outputs.
 * Ported from guide Section 7.1. The only behavioural change is the fixed
 * nextSendWindow (non-wrapping quiet hours, holidays, DST, termination).
 */
export function decide(ctx: Ctx): Action[] {
  const { invoice, customer, history, policy, settings } = ctx;
  if (NO_CONTACT_STATUSES.includes(invoice.status)) return [];

  const now = DateTime.fromJSDate(ctx.now).setZone(settings.timezone);
  const today = now.startOf('day');
  const due = DateTime.fromISO(invoice.dueOn, { zone: settings.timezone }).startOf('day');
  const daysOverdue = Math.floor(today.diff(due, 'days').days);

  if (daysOverdue <= 0) {
    return [{ kind: 'wait_until', at: due.plus({ days: 1 }).toJSDate() }];
  }

  const actions: Action[] = [];
  if (invoice.status === 'open') actions.push({ kind: 'mark_overdue' });

  if (customer.optedOut) {
    if (!history.escalated) actions.push({ kind: 'escalate', reason: 'customer_opted_out' });
    return actions;
  }

  if (invoice.status === 'promised' && invoice.promisedOn) {
    const deadline = DateTime.fromISO(invoice.promisedOn, { zone: settings.timezone })
      .plus({ days: policy.graceDaysAfterPromise })
      .endOf('day');
    if (now <= deadline) return [{ kind: 'wait_until', at: deadline.plus({ minutes: 1 }).toJSDate() }];
    actions.push({ kind: 'mark_promise_broken' });
  }

  // Array.prototype.sort is stable, so steps sharing daysAfterDue keep policy order.
  const nextStep = policy.steps
    .filter((s) => !history.sentStepIds.includes(s.id))
    .sort((a, b) => a.daysAfterDue - b.daysAfterDue)[0];

  if (nextStep && nextStep.daysAfterDue <= daysOverdue) {
    // A rolling 168 hours (absolute time). The guide's minus({ days: 7 }) is calendar
    // math in the tenant zone: only 167 h across spring-forward, allowing cap + 1.
    const weekAgo = now.minus({ hours: 7 * 24 });
    const recent = history.sentAt.filter((d) => DateTime.fromJSDate(d) > weekAgo).length;
    const window = nextSendWindow(now, settings);
    if (recent >= policy.maxMessagesPerWeek) {
      const tomorrow10 = now.plus({ days: 1 }).startOf('day').set({ hour: 10 });
      actions.push({ kind: 'wait_until', at: tomorrow10.toJSDate() });
    } else if (!window.ok) {
      // No safe send time exists (only reachable with invalid settings): never send.
    } else if (window.at > now) {
      actions.push({ kind: 'wait_until', at: window.at.toJSDate() });
    } else {
      const idempotencyKey = reminderKey(invoice.id, nextStep.id, nextStep.channel);
      actions.push({ kind: 'send_reminder', step: nextStep, idempotencyKey });
    }
    return actions;
  }

  if (!nextStep && daysOverdue >= policy.escalateAfterDays && !history.escalated) {
    actions.push({ kind: 'escalate', reason: 'sequence_exhausted_unpaid' });
    return actions;
  }

  if (nextStep) {
    const at = due.plus({ days: nextStep.daysAfterDue }).set({ hour: 10 });
    const window = nextSendWindow(at, settings);
    actions.push({ kind: 'wait_until', at: (window.ok ? window.at : at).toJSDate() });
  }
  return actions;
}
