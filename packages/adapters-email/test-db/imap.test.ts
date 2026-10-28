// IMAP poller against a real IMAP server (GreenMail 2.1.14 in Docker, `-Dgreenmail.users` per its docs) and
// the real local database, then through the real inbound processor. Read-only is checked on the server.
import { spawnSync } from 'node:child_process';
import { ImapFlow } from 'imapflow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analysis, mail, pool, q, quietCron, replyWorld, tasksOf, type ReplyWorld } from '../../inbound/test-db/harness.ts';
import { MAX_IMAP_BYTES, pgImapStore, pollMailbox, type ImapSettings } from '../src/index.ts';

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
const append = (box: string, raw: string) => admin((c) => c.append(box, raw));
const poll = (w: ReplyWorld, box: string) => pollMailbox(settings(box), PASSWORD, w.emailAccountId, pgImapStore(pool), () => w.clock.now());
const events = (w: ReplyWorld) => q<{ provider_event_id: string; payload: Record<string, unknown> | null }>('select provider_event_id, payload from public.inbound_events where tenant_id = $1 order by id', [w.tenantId]);

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');

describe('IMAP poller (read-only) -> inbound processor', () => {
  it('polls threading, UTF-8 names, multipart, HTML-only, attachments, DSN bounce and auto-reply; never marks anything seen', async () => {
    const w = await replyWorld();
    const box = `t-${w.tenantId.slice(0, 8)}`;
    await freshMailbox(box);
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
    const box = `h-${w.tenantId.slice(0, 8)}`;
    await freshMailbox(box);
    await append(box, mail({ from: 'Ada Customer <ada@customer.example>', messageId: '<big@customer.example>', body: 'x'.repeat(MAX_IMAP_BYTES + 1000) }));
    expect(await poll(w, box)).toMatchObject({ seen: 1, stored: 1, tooLarge: 1 });
    expect(await poll(w, box)).toMatchObject({ seen: 0, stored: 0 });
    expect((await events(w))[0]?.payload).toMatchObject({ tooLarge: true });
    await w.run();
    expect(await tasksOf(w.tenantId)).toMatchObject([{ type: 'unprocessed_inbound', reason: 'processing_failed' }]);
  }, 120_000);

  it('UIDVALIDITY change (mailbox recreated): everything is re-read, no duplicate events', async () => {
    const w = await replyWorld();
    const box = `u-${w.tenantId.slice(0, 8)}`;
    await freshMailbox(box);
    const raws = [1, 2, 3].map((i) => mail({ from: 'Ada Customer <ada@customer.example>', messageId: `<uv${i}@customer.example>`, body: `message ${i}` }));
    for (const raw of raws) await append(box, raw);
    expect(await poll(w, box)).toMatchObject({ seen: 3, stored: 3 });
    await freshMailbox(box); // new UIDVALIDITY, same messages appended again
    for (const raw of raws) await append(box, raw);
    const r = await poll(w, box);
    expect(r).toMatchObject({ seen: 3, stored: 0, uidValidityChanged: true });
    expect(await events(w)).toHaveLength(3);
  }, 120_000);
});
