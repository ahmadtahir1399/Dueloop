// One pass over the connected mailboxes (ADR 0054). Each mailbox fails on its own: a bad password at one business
// never stops another's replies. Nothing here sends a message to a customer or changes an invoice: the poller only
// stores events, and the inbound processor decides what they mean.
import { MailboxError, type MailboxStore, type pollMailbox } from '@dueloop/adapters-email';
import type { Logger } from './logger.ts';
import type { Clock, Notifier } from './ports.ts';

export interface MailboxDeps {
  readonly store: MailboxStore;
  readonly db: { firstNotification(tenantId: string, dedupeKey: string, period: string, kind: string, at: Date): Promise<boolean> };
  readonly clock: Clock;
  readonly logger: Logger;
  readonly notifier: Notifier;
  readonly poll: typeof pollMailbox;
}

/** A blip is not worth an alert; three failures in a row means replies are not arriving. */
export const ALERT_AFTER_FAILURES = 3;

async function alertOnce(deps: MailboxDeps, tenantId: string, code: string): Promise<void> {
  try {
    const now = deps.clock.now();
    // At most one a day, for as long as it stays broken.
    if (!(await deps.db.firstNotification(tenantId, 'mailbox_failed', now.toISOString().slice(0, 10), 'mailbox_failed', now))) return;
    await deps.notifier.notify({ tenantId, dedupeKey: 'mailbox_failed', kind: 'mailbox_failed', severity: 'critical', title: 'Customer email replies are not being read', lines: [`reason: ${code}`, 'See Settings > Integrations.'] });
  } catch {
    deps.logger.warn('notify_failed', { tenantId, reason: 'mailbox_failed' }); // a failed alert never fails the pass
  }
}

export async function pollDueMailboxes(deps: MailboxDeps, tenantId: string | null = null): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  const add = (k: string, n: number) => {
    if (n) totals[k] = (totals[k] ?? 0) + n;
  };
  for (const a of await deps.store.dueAccounts(deps.clock.now(), tenantId)) {
    try {
      const r = await deps.poll(a.settings, a.password, a.id, deps.store, () => deps.clock.now());
      await deps.store.recordOk(a.id, a.settings.mailbox, deps.clock.now());
      add('mailboxes', 1);
      add('seen', r.seen);
      add('stored', r.stored);
      add('skipped', r.skipped);
      add('too_large', r.tooLarge);
      add('baselined', r.baselined ? 1 : 0);
      if (r.uidValidityChanged) deps.logger.warn('mailbox_uidvalidity_changed', { tenantId: a.tenantId });
    } catch (e) {
      const code = e instanceof MailboxError ? e.code : 'poll_failed';
      const failures = await deps.store.recordFailure(a.id, a.settings.mailbox, code, deps.clock.now());
      add('failed', 1);
      deps.logger.warn('mailbox_poll_failed', { tenantId: a.tenantId, reason: code, attempt: failures });
      if (failures >= ALERT_AFTER_FAILURES) await alertOnce(deps, a.tenantId, code);
    }
  }
  return totals;
}
