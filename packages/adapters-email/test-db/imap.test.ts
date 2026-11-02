// IMAP poller against a real IMAP server (GreenMail 2.1.14 in Docker, `-Dgreenmail.users` per its docs) and
// the real local database, then through the real inbound processor. Read-only is checked on the server.
// GreenMail has no TLS and listens on 127.0.0.1, so these tests allow both; test/imap-guard.test.ts covers the refusals.
import { spawnSync } from 'node:child_process';
import { ImapFlow } from 'imapflow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysis, mail, pool, q, quietCron, replyWorld, tasksOf, type ReplyWorld } from '../../inbound/test-db/harness.ts';
import { MAX_IMAP_BYTES, pgImapStore, pollMailbox, type ImapSettings, type PollOptions } from '../src/index.ts';

const NAME = 'dueloop-greenmail-test';
const IMAGE = 'greenmail/standalone:2.1.14';
const PORT = 3143;
const settings = (mailbox: string): ImapSettings => ({ host: '127.0.0.1', port: PORT, secure: false, user: 'billing', mailbox });
const PASSWORD = 'secret';

const docker = (...args: string[]) => spawnSync('docker', args, { encoding: 'utf8' });

async function admin<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = new ImapFlow({ host: '127.0.0.1', port: PORT, secure: false, auth: { user: 'billing', pass: PASSWORD }, logger: false });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.logout().catch(() => undefined);
  }
}

beforeAll(async () => {
  await quietCron();
  docker('rm', '-f', NAME);
  const run = docker('run', '-d', '--name', NAME, '-p', `${PORT}:3143`, '-e', 'GREENMAIL_OPTS=-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=billing:secret@test-co.example', IMAGE);
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
  for (let i = 0; i < 60; i++) {
    try {
      await admin(async () => undefined);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('GreenMail did not start');
}, 120_000);

afterAll(async () => {
  docker('rm', '-f', NAME);
  await pool.end();
});

async function freshMailbox(name: string): Promise<void> {
  await admin(async (c) => {
    await c.mailboxDelete(name).catch(() => undefined);
    await c.mailboxCreate(name);
  });
}
const append = (box: string, raw: string, internalDate?: Date) => admin((c) => c.append(box, raw, [], internalDate));
const poll = (w: ReplyWorld, box: string, options: PollOptions = {}) =>
  pollMailbox(settings(box), PASSWORD, w.emailAccountId, pgImapStore(pool), () => w.clock.now(), { addressAllowed: () => true, allowPlaintext: true, ...options });
/** A new mailbox that has had its first poll, so everything appended next counts as new mail. */
async function connected(w: ReplyWorld, prefix: string): Promise<string> {
  const box = `${prefix}-${w.tenantId.slice(0, 8)}`;
  await freshMailbox(box);
  expect(await poll(w, box)).toMatchObject({ baselined: true });
  return box;
}
const events =(w: ReplyWorld) => q<{ provider_event_id: string; payload: Record<string, unknown> | null }>('select provider_event_id, payload from public.inbound_events where tenant_id = $1 order by id', [w.tenantId]);

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');

describe('IMAP poller (read-only) -> inbound processor', () => {
  it('polls threading, UTF-8 names, multipart, HTML-only, attachments, DSN bounce and auto-reply; never marks anything seen', async () => {
    const w = await replyWorld();
    const box = await connected(w, 't');
    const inv = w.invoices[0];
    w.script.push(['15th', analysis('promise_to_pay', { promisedDate: '2026-11-15' })]);
    w.script.push(['invoice copy', analysis('needs_info')]);
    await append(box, mail({ from: '=?UTF-8?Q?Ad=C3=A1_Customer?= <ada@customer.example>', messageId: '<i1@customer.example>', inReplyTo: inv?.rfcId, body: "I'll pay on the 15th." }));
    await append(
      box,
      crlf(`From: Ada Customer <ada@customer.example>\nTo: billing@test-co.example\nSubject: Re: Reminder\nMessage-ID: <i2@customer.example>\nIn-Reply-To: ${inv?.rfcId}\nDate: Tue, 20 Oct 2026 10:00:00 +0100\nContent-Type: text/html; charset=utf-8\n\n<p>Please send an <b>invoice copy</b>.</p>`),
    );
    await append(
      box,
      crlf(`From: Ada Customer <ada@customer.example>\nTo: billing@test-co.example\nSubject: proof\nMessage-ID: <i3@customer.example>\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary="XX"\n\n--XX\nContent-Type: text/plain\n\nhello\n--XX\nContent-Type: application/pdf; name="r.pdf"\nContent-Disposition: attachment; filename="r.pdf"\nContent-Transfer-Encoding: base64\n\nJVBERi0xLjQK\n--XX--\n`),
    );
    await append(box, mail({ from: 'Ada Customer <ada@customer.example>', messageId: '<i4@customer.example>', inReplyTo: inv?.rfcId, subject: 'Out of office', headers: 'Auto-Submitted: auto-replied', body: 'Away until Monday.' }));
    await append(
      box,
      crlf(`From: MAILER-DAEMON@mx.example\nTo: billing@test-co.example\nSubject: Undelivered\nMessage-ID: <dsn9@mx.example>\nMIME-Version: 1.0\nContent-Type: multipart/report; report-type=delivery-status; boundary="RR"\n\n--RR\nContent-Type: message/delivery-status\n\nReporting-MTA: dns; mx.example\n\nAction: failed\nStatus: 5.1.1\n--RR\nContent-Type: text/rfc822-headers\n\nMessage-ID: ${inv?.rfcId}\n--RR--\n`),
    );

    const r = await poll(w, box);
    expect(r).toMatchObject({ seen: 5, stored: 5, tooLarge: 0, uidValidityChanged: false });
    // Read-only: nothing on the server changed (no \Seen, nothing moved or deleted).
    const flags = await admin(async (c) => {
      await c.mailboxOpen(box, { readOnly: true });
      return (await c.fetchAll('1:*', { flags: true })).map((m) => [...(m.flags ?? [])]);
    });
    expect(flags).toHaveLength(5);
    expect(flags.every((f) => !f.includes('\\Seen'))).toBe(true);

    await w.run();
    expect((await q<{ status: string }>('select status from public.invoices where id = $1', [inv?.id]))[0]?.status).toBe('promised');
    const msgs = await q<{ prefilter: string; attachments: unknown[] }>(`select prefilter, attachments from public.messages where tenant_id = $1 and direction = 'in' order by provider_message_id`, [w.tenantId]);
    expect(msgs.map((m) => m.prefilter).sort()).toEqual(['auto_reply', 'bounce', 'none', 'none', 'none']);
    expect(msgs.flatMap((m) => m.attachments)).toEqual([{ name: 'r.pdf', mime: 'application/pdf', size: expect.any(Number) }]);
    // info copy -> info_request; bounce -> invalid_contact (5.1.1); the unclear 'hello' -> human_review.
    expect((await tasksOf(w.tenantId)).map((t) => t.type).sort()).toEqual(['human_review', 'info_request', 'invalid_contact']);
  }, 120_000);

  it('a second poll stores nothing new; a huge message is never downloaded and becomes a task', async () => {
    const w = await replyWorld();
    const box = await connected(w, 'h');
    await append(box, mail({ from: 'Ada Customer <ada@customer.example>', messageId: '<big@customer.example>', body: 'x'.repeat(MAX_IMAP_BYTES + 1000) }));
    expect(await poll(w, box)).toMatchObject({ seen: 1, stored: 1, tooLarge: 1 });
    expect(await poll(w, box)).toMatchObject({ seen: 0, stored: 0 });
    expect((await events(w))[0]?.payload).toMatchObject({ tooLarge: true });
    await w.run();
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'unprocessed_inbound', reason: 'processing_failed' }]);
  }, 120_000);

  it('UIDVALIDITY change (mailbox recreated): recent mail is re-read, no duplicate events', async () => {
    const w = await replyWorld();
    const box = await connected(w, 'u');
    const raws = [1, 2, 3].map((i) => mail({ from: 'Ada Customer <ada@customer.example>', messageId: `<uv${i}@customer.example>`, body: `message ${i}` }));
    for (const raw of raws) await append(box, raw);
    expect(await poll(w, box)).toMatchObject({ seen: 3, stored: 3 });
    await freshMailbox(box); // new UIDVALIDITY, same messages appended again
    for (const raw of raws) await append(box, raw);
    const r = await poll(w, box);
    expect(r).toMatchObject({ seen: 3, stored: 0, uidValidityChanged: true });
    expect(await events(w)).toHaveLength(3);
  }, 120_000);

  it('UIDVALIDITY change: mail from before the last good poll stays unread', async () => {
    const w = await replyWorld();
    const box = await connected(w, 'o');
    await new Promise((r) => setTimeout(r, 1100)); // GreenMail's UIDVALIDITY changes once a second
    await freshMailbox(box);
    await append(box, mail({ from: 'Ada Customer <ada@customer.example>', messageId: '<old@customer.example>', body: 'from last month' }), new Date(Date.now() - 30 * 86_400_000));
    await append(box, mail({ from: 'Ada Customer <ada@customer.example>', messageId: '<new@customer.example>', body: 'from today' }));
    expect(await poll(w, box)).toMatchObject({ seen: 1, stored: 1, uidValidityChanged: true });
    expect((await events(w)).map((e) => e.provider_event_id)).toEqual(['<new@customer.example>']);
    expect(await poll(w, box)).toMatchObject({ seen: 0, uidValidityChanged: false });
  }, 120_000);

  it('connecting a mailbox never reads its history: the first poll only takes a baseline', async () => {
    const w = await replyWorld();
    const box = `b-${w.tenantId.slice(0, 8)}`;
    await freshMailbox(box);
    await append(box, mail({ from: 'Ada Customer <ada@customer.example>', messageId: '<history@customer.example>', body: 'an old conversation' }));
    expect(await poll(w, box)).toEqual({ seen: 0, stored: 0, tooLarge: 0, skipped: 0, uidValidityChanged: false, baselined: true });
    expect(await events(w)).toEqual([]);
    await append(box, mail({ from: 'Ada Customer <ada@customer.example>', messageId: '<fresh@customer.example>', body: 'a new reply' }));
    expect(await poll(w, box)).toMatchObject({ seen: 1, stored: 1, baselined: false });
    expect((await events(w)).map((e) => e.provider_event_id)).toEqual(['<fresh@customer.example>']);
  }, 120_000);

  it('mail that has nothing to do with customers is never stored; a reply in our thread is, whoever sends it', async () => {
    const w = await replyWorld();
    const box = await connected(w, 'r');
    const rfc = w.invoices[0]?.rfcId;
    await append(box, mail({ from: 'News <news@shop.example>', messageId: '<newsletter@shop.example>', body: 'Our autumn sale' }));
    await append(box, mail({ from: 'Colleague <bo@customer.example>', messageId: '<thread@customer.example>', inReplyTo: rfc, body: 'I handle Ada’s invoices.' }));
    await append(box, mail({ from: 'Colleague <bo@customer.example>', messageId: '<refs@customer.example>', references: `<other@x.example> ${rfc}`, body: 'Copying in accounts.' }));
    await append(box, mail({ from: 'ADA@CUSTOMER.EXAMPLE', messageId: '<upper@customer.example>', body: 'Sent from my phone' }));
    await append(
      box,
      crlf(`From: Delivery System <bounces@mx.example>\nTo: billing@test-co.example\nSubject: Undelivered\nMessage-ID: <report@mx.example>\nMIME-Version: 1.0\nContent-Type: multipart/report; report-type=delivery-status; boundary="RR"\n\n--RR\nContent-Type: message/delivery-status\n\nReporting-MTA: dns; mx.example\n\nAction: failed\nStatus: 5.1.1\n--RR--\n`),
    );
    expect(await poll(w, box)).toMatchObject({ seen: 5, stored: 4, skipped: 1 });
    expect((await events(w)).map((e) => e.provider_event_id).sort()).toEqual(['<refs@customer.example>', '<report@mx.example>', '<thread@customer.example>', '<upper@customer.example>']);
  }, 120_000);

  it('another business’s customer or thread does not make mail relevant here', async () => {
    const [w, other] = [await replyWorld(), await replyWorld()];
    const box = await connected(w, 'x');
    await append(box, mail({ from: 'Stranger <bo@elsewhere.example>', messageId: '<cross@elsewhere.example>', inReplyTo: other.invoices[0]?.rfcId, body: 'About the other business' }));
    expect(await poll(w, box)).toMatchObject({ seen: 1, stored: 0, skipped: 1 });
  }, 120_000);

  it('a backlog is read in batches: the cursor picks up where the last poll stopped', async () => {
    const w = await replyWorld();
    const box = await connected(w, 'p');
    for (const i of [1, 2, 3]) await append(box, mail({ from: 'Ada Customer <ada@customer.example>', messageId: `<batch${i}@customer.example>`, body: `message ${i}` }));
    expect(await poll(w, box, { maxMessages: 2 })).toMatchObject({ seen: 2, stored: 2 });
    expect(await poll(w, box, { maxMessages: 2 })).toMatchObject({ seen: 1, stored: 1 });
    expect(await poll(w, box, { maxMessages: 2 })).toMatchObject({ seen: 0 });
  }, 120_000);

  it('a connected mailbox: settings and password come from the database and log in', async () => {
    const w = await replyWorld();
    const box = `c-${w.tenantId.slice(0, 8)}`;
    await freshMailbox(box);
    await q('select private.set_mailbox($1, $2::jsonb, $3, null)', [w.tenantId, JSON.stringify({ host: '127.0.0.1', port: PORT, user: 'billing', mailbox: box }), PASSWORD]);
    const store = pgImapStore(pool);
    const [account] = await store.dueAccounts(w.clock.now(), w.tenantId);
    expect(account).toMatchObject({ id: w.emailAccountId, tenantId: w.tenantId, settings: { host: '127.0.0.1', port: PORT, secure: false, user: 'billing', mailbox: box } });
    if (!account) throw new Error('no account');
    const r = await pollMailbox(account.settings, account.password, account.id, store, () => w.clock.now(), { addressAllowed: () => true, allowPlaintext: true });
    expect(r).toMatchObject({ baselined: true });
    await store.recordOk(account.id, box, w.clock.now());
    expect(await store.dueAccounts(w.clock.now(), w.tenantId)).toHaveLength(1); // polled again next pass
  }, 120_000);

  it('a failing mailbox backs off (doubling to an hour), and one good poll clears it', async () => {
    const w = await replyWorld();
    await q('select private.set_mailbox($1, $2::jsonb, $3, null)', [w.tenantId, JSON.stringify({ host: 'imap.shop.example', port: 993, user: 'billing', mailbox: 'INBOX' }), PASSWORD]);
    const store = pgImapStore(pool);
    const at = w.clock.now();
    const nextIn = async () => {
      const [x] = await q<{ s: number; failures: number; last_error: string | null }>(
        `select extract(epoch from c.next_attempt_at - $2::timestamptz)::int as s, c.failures, c.last_error from private.imap_cursors c where c.channel_account_id = $1`,
        [w.emailAccountId, at],
      );
      return x;
    };
    expect(await store.recordFailure(w.emailAccountId, 'INBOX', 'login_failed', at)).toBe(1);
    expect(await nextIn()).toMatchObject({ s: 120, failures: 1, last_error: 'login_failed' });
    expect(await store.dueAccounts(at, w.tenantId)).toEqual([]);
    expect(await store.dueAccounts(new Date(at.getTime() + 121_000), w.tenantId)).toHaveLength(1);
    await store.recordFailure(w.emailAccountId, 'INBOX', 'login_failed', at);
    expect(await nextIn()).toMatchObject({ s: 240, failures: 2 });
    for (let i = 0; i < 20; i++) await store.recordFailure(w.emailAccountId, 'INBOX', 'login_failed', at);
    expect(await nextIn()).toMatchObject({ s: 3600, failures: 22 });
    await store.recordOk(w.emailAccountId, 'INBOX', at);
    expect(await nextIn()).toMatchObject({ s: null, failures: 0, last_error: null });
  }, 120_000);
});
