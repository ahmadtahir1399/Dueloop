// Email fixtures are hand-written RFC 5322 / RFC 3464 / RFC 3834 messages; WhatsApp fixtures follow the
// payload shapes in Meta's webhook reference (messages/text, messages/status), read 2026-10-28.
import { describe, expect, it } from 'vitest';
import { MAX_EMAIL_BYTES, normaliseEmail, stripQuoted } from '../src/email.ts';
import { matchInvoices } from '../src/match.ts';
import { isAutoReply, isOptOutKeyword, prefilter } from '../src/prefilter.ts';
import { normaliseWhatsApp, splitWhatsAppWebhook } from '../src/whatsapp.ts';

const crlf = (s: string) => s.replace(/\n/g, '\r\n');
const plainReply = crlf(`From: =?UTF-8?Q?M=C3=BCller_GmbH?= <Buchhaltung@Mueller.example>
To: billing@demo-agency.test
Subject: Re: Friendly reminder: invoice DA-0004
Message-ID: <reply-1@mueller.example>
In-Reply-To: <5eed.s1.email.dueloop@demo-agency.test>
References: <older@demo-agency.test> <5eed.s1.email.dueloop@demo-agency.test>
Date: Tue, 20 Oct 2026 09:15:00 +0100
Content-Type: text/plain; charset=utf-8

Can't pay until the 15th, sorry.

Grüße
--
Max

On Mon, 19 Oct 2026 at 10:00, Demo Agency <billing@demo-agency.test> wrote:
> Hi Müller GmbH,
> A quick reminder that invoice DA-0004 ...
`);

describe('email normalisation', () => {
  it('plain reply: sender lower-cased, threading ids, new text without quoted history, UTF-8 name decoded', async () => {
    const r = await normaliseEmail(plainReply);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message.from).toBe('buchhaltung@mueller.example');
    expect(r.message.inReplyTo).toBe('<5eed.s1.email.dueloop@demo-agency.test>');
    expect(r.message.references).toEqual(['<older@demo-agency.test>', '<5eed.s1.email.dueloop@demo-agency.test>']);
    expect(r.message.newText).toBe("Can't pay until the 15th, sorry.\n\nGrüße\n--\nMax");
    expect(r.message.providerTimestamp?.toISOString()).toBe('2026-10-20T08:15:00.000Z');
  });

  it('HTML-only mail becomes text; scripts and images are dropped, never rendered', async () => {
    const raw = crlf(`From: a@b.example\nTo: x@y.example\nSubject: hi\nMessage-ID: <h@b.example>\nContent-Type: text/html; charset=utf-8\n\n<p>I <b>already paid</b>.</p><script>alert(1)</script><img src="http://track.example/p.gif"><a href="http://evil.example">click</a>`);
    const r = await normaliseEmail(raw);
    expect(r.ok && r.message.fullText).toBe('I already paid.\n\nclick');
  });

  it('multipart with an attachment: attachment is metadata only', async () => {
    const raw = crlf(`From: a@b.example
To: x@y.example
Subject: proof
Message-ID: <m@b.example>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="XX"

--XX
Content-Type: text/plain; charset=utf-8

See attached.
--XX
Content-Type: application/pdf; name="receipt.pdf"
Content-Disposition: attachment; filename="receipt.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--XX--
`);
    const r = await normaliseEmail(raw);
    expect(r.ok && r.message.attachments).toEqual([{ name: 'receipt.pdf', mime: 'application/pdf', size: expect.any(Number) }]);
    expect(r.ok && r.message.newText).toBe('See attached.');
  });

  it('a huge message is rejected before parsing', async () => {
    const raw = `From: a@b.example\r\nMessage-ID: <big@b>\r\n\r\n${'x'.repeat(MAX_EMAIL_BYTES + 1)}`;
    expect(await normaliseEmail(raw)).toEqual({ ok: false, error: 'too_large' });
  });

  it('garbage or a message without Message-ID/From is unparseable', async () => {
    expect(await normaliseEmail('not an email at all')).toEqual({ ok: false, error: 'unparseable' });
  });

  it('RFC 3464 DSN: bounce with action, status and the Message-ID of OUR message', async () => {
    const raw = crlf(`From: Mail Delivery System <MAILER-DAEMON@mx.example>
To: billing@demo-agency.test
Subject: Undelivered Mail Returned to Sender
Message-ID: <dsn-1@mx.example>
MIME-Version: 1.0
Content-Type: multipart/report; report-type=delivery-status; boundary="RR"

--RR
Content-Type: text/plain

This is the mail system. Your message could not be delivered.
--RR
Content-Type: message/delivery-status

Reporting-MTA: dns; mx.example

Final-Recipient: rfc822; gone@customer.example
Action: failed
Status: 5.1.1
--RR
Content-Type: text/rfc822-headers

Message-ID: <5eed.s1.email.dueloop@demo-agency.test>
Subject: Friendly reminder: invoice DA-0001
--RR--
`);
    const r = await normaliseEmail(raw);
    expect(r.ok && r.message.report).toEqual({ action: 'failed', status: '5.1.1', originalMessageId: '<5eed.s1.email.dueloop@demo-agency.test>' });
    expect(r.ok && prefilter(r.message, [])).toBe('bounce');
  });

  it('RFC 3834 auto-reply: Auto-Submitted other than "no", Precedence, vendor headers, OOO subject', async () => {
    const mk = (h: string, subject = 'Re: invoice') =>
      normaliseEmail(crlf(`From: a@b.example\nTo: x@y.example\nSubject: ${subject}\nMessage-ID: <ar@b>\n${h}Content-Type: text/plain\n\nI am away until Monday.\n`));
    const ok = async (h: string, subject?: string) => {
      const r = await mk(h, subject);
      return r.ok && isAutoReply(r.message);
    };
    expect(await ok('Auto-Submitted: auto-replied\n')).toBe(true);
    expect(await ok('Auto-Submitted: auto-generated\n')).toBe(true);
    expect(await ok('Auto-Submitted: no\n')).toBe(false);
    expect(await ok('Precedence: bulk\n')).toBe(true);
    expect(await ok('X-Autoreply: yes\n')).toBe(true);
    expect(await ok('', 'Out of Office: back Monday')).toBe(true);
    expect(await ok('')).toBe(false);
  });

  it('quoted history heuristic: Outlook block, German attribution, fallback head when no marker', () => {
    expect(stripQuoted('Paid today.\n\nFrom: Demo Agency\nSent: Monday\nSubject: x\nold text').text).toBe('Paid today.');
    expect(stripQuoted('Ich zahle am 15.\n\nAm 19.10.2026 um 10:00 schrieb Demo Agency <b@d.test>:\n> alt').text).toBe('Ich zahle am 15.');
    expect(stripQuoted('no markers here').text).toBe('no markers here');
  });
});

describe('opt-out keywords (short messages only)', () => {
  it.each(['STOP', 'stop.', 'Stop please', 'unsubscribe', 'stop calling me', 'Abmelden', 'darme de baja', 'STOPP bitte'])('"%s" => opt-out', (t) => {
    expect(isOptOutKeyword(t)).toBe(true);
  });
  it.each(["don't stop", 'Please do not stop sending me the invoices, I need them for accounting.', 'I will stop by your office tomorrow to pay', 'stopped paying because the work was not done'])('"%s" => not a keyword (goes to the model)', (t) => {
    expect(isOptOutKeyword(t)).toBe(false);
  });
});

describe('WhatsApp webhook payloads', () => {
  const body = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: '106540352242922' },
              contacts: [{ profile: { name: 'Imran' }, wa_id: '923001234567' }],
              messages: [{ from: '923001234567', id: 'wamid.IN1', timestamp: '1760950000', type: 'text', text: { body: 'Will pay Friday' }, context: { from: '15550001111', id: 'wamid.OUT1' } }],
              statuses: [{ id: 'wamid.OUT2', status: 'delivered', timestamp: '1760950100', recipient_id: '923001234567' }],
            },
          },
        ],
      },
    ],
  };
  it('splits one POST into one item per message and per status, with dedupe keys', () => {
    expect(splitWhatsAppWebhook(body).map((i) => [i.kind, i.providerEventId, i.phoneNumberId])).toEqual([
      ['message', 'wamid.IN1', '106540352242922'],
      ['status', 'wamid.OUT2:delivered', '106540352242922'],
    ]);
    expect(splitWhatsAppWebhook({ object: 'page', entry: [] })).toEqual([]);
  });
  it('normalises a text message (context id = reply-to) and a status', () => {
    const [m, s] = splitWhatsAppWebhook(body);
    const nm = m && normaliseWhatsApp(m.kind, m.item);
    expect(nm?.ok && nm.value).toMatchObject({ kind: 'message', from: '923001234567', inReplyTo: 'wamid.OUT1', newText: 'Will pay Friday' });
    const ns = s && normaliseWhatsApp(s.kind, s.item);
    expect(ns?.ok && ns.value).toMatchObject({ kind: 'status', providerMessageId: 'wamid.OUT2', status: 'delivered', timestamp: new Date(1760950100 * 1000) });
  });
});

describe('matching (never guess)', () => {
  const now = new Date('2026-10-20T10:00:00Z');
  const inv = (id: string, daysAgo: number | null) => ({ invoiceId: id, number: id.toUpperCase(), status: 'overdue', lastOutboundAt: daysAgo === null ? null : new Date(now.getTime() - daysAgo * 86_400_000) });
  it('a thread hit wins', () => {
    expect(matchInvoices({ channel: 'email', threadHits: [{ messageId: 'm1', invoiceIds: ['b'] }], openInvoices: [inv('a', 1), inv('b', 2)], now })).toMatchObject({ kind: 'matched', by: 'thread', invoiceIds: ['b'] });
  });
  it('one recently-reminded open invoice => that invoice', () => {
    expect(matchInvoices({ channel: 'email', threadHits: [], openInvoices: [inv('a', 3), inv('b', 45), inv('c', null)], now })).toMatchObject({ kind: 'matched', by: 'single_open_invoice', invoiceIds: ['a'] });
  });
  it('three recently-reminded invoices and no thread => no match, candidates listed', () => {
    const r = matchInvoices({ channel: 'email', threadHits: [], openInvoices: [inv('a', 1), inv('b', 2), inv('c', 3)], now });
    expect(r.kind === 'none' && r.candidates.map((c) => c.invoiceId)).toEqual(['a', 'b', 'c']);
  });
});
