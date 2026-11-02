// One pass over the connected mailboxes: each fails alone, and a mailbox that stays broken tells the business.
import { MailboxError, type MailboxAccount, type MailboxStore, type pollMailbox } from '@dueloop/adapters-email';
import { describe, expect, it, vi } from 'vitest';
import { ALERT_AFTER_FAILURES, pollDueMailboxes, type MailboxDeps } from '../src/mailbox.ts';

const account = (tenantId: string): MailboxAccount => ({ id: `acct-${tenantId}`, tenantId, password: 'the-password', settings: { host: 'imap.shop.example', port: 993, secure: true, user: 'billing@shop.example', mailbox: 'INBOX' } });
const ok = { seen: 2, stored: 1, tooLarge: 0, skipped: 1, uidValidityChanged: false, baselined: false };

function world(accounts: MailboxAccount[], poll: typeof pollMailbox, failures = 1) {
  const store = { dueAccounts: vi.fn(async () => accounts), recordOk: vi.fn(async () => undefined), recordFailure: vi.fn(async () => failures) };
  const logged: string[] = [];
  const log = (event: string, fields?: object) => void logged.push(JSON.stringify({ event, ...fields }));
  const notify = vi.fn(async () => undefined);
  const firstNotification = vi.fn(async () => true);
  const deps: MailboxDeps = {
    store: store as unknown as MailboxStore,
    db: { firstNotification },
    clock: { now: () => new Date('2026-11-02T10:00:00Z') },
    logger: { info: log, warn: log, error: log },
    notifier: { notify },
    poll,
  };
  return { deps, store, logged, notify, firstNotification };
}

describe('pollDueMailboxes', () => {
  it('one bad mailbox does not stop the next one', async () => {
    const poll = vi.fn<typeof pollMailbox>(async (_s, _p, id) => {
      if (id === 'acct-a') throw new MailboxError('login_failed');
      return ok;
    });
    const w = world([account('a'), account('b')], poll);
    expect(await pollDueMailboxes(w.deps)).toEqual({ failed: 1, mailboxes: 1, seen: 2, stored: 1, skipped: 1 });
    expect(w.store.recordFailure).toHaveBeenCalledWith('acct-a', 'INBOX', 'login_failed', expect.any(Date));
    expect(w.store.recordOk).toHaveBeenCalledWith('acct-b', 'INBOX', expect.any(Date));
  });

  it('an unexpected error is recorded as a code, and nothing about it or the mailbox is logged', async () => {
    const w = world([account('a')], async () => {
      throw new Error('imap.shop.example said no to billing@shop.example with the-password');
    });
    await pollDueMailboxes(w.deps);
    expect(w.store.recordFailure).toHaveBeenCalledWith('acct-a', 'INBOX', 'poll_failed', expect.any(Date));
    expect(w.logged.join('\n')).not.toMatch(/shop\.example|the-password/);
  });

  it('stays quiet about a blip', async () => {
    const w = world([account('a')], async () => Promise.reject(new MailboxError('connect_failed')), ALERT_AFTER_FAILURES - 1);
    await pollDueMailboxes(w.deps);
    expect(w.notify).not.toHaveBeenCalled();
  });

  it('alerts when replies have stopped arriving, without naming the mailbox', async () => {
    const w = world([account('a')], async () => Promise.reject(new MailboxError('login_failed')), ALERT_AFTER_FAILURES);
    await pollDueMailboxes(w.deps);
    expect(w.notify).toHaveBeenCalledOnce();
    expect(JSON.stringify(w.notify.mock.calls)).toContain('login_failed');
    expect(JSON.stringify(w.notify.mock.calls)).not.toMatch(/shop\.example|the-password/);
  });

  it('alerts at most once a day', async () => {
    const w = world([account('a')], async () => Promise.reject(new MailboxError('login_failed')), ALERT_AFTER_FAILURES);
    w.firstNotification.mockResolvedValue(false);
    await pollDueMailboxes(w.deps);
    expect(w.notify).not.toHaveBeenCalled();
  });

  it('a failed alert never fails the pass', async () => {
    const w = world([account('a'), account('b')], async () => Promise.reject(new MailboxError('login_failed')), ALERT_AFTER_FAILURES);
    w.notify.mockRejectedValue(new Error('slack is down'));
    expect(await pollDueMailboxes(w.deps)).toEqual({ failed: 2 });
  });
});
