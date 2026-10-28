// SMTP adapter against the local mail catcher (Mailpit, part of the local Supabase stack once [local_smtp]
// is enabled): headers, plain-text body, UTF-8 names, and CRLF injection attempts never create headers.
import { describe, expect, it } from 'vitest';
import { sanitiseDisplayName, sanitiseHeaderValue, type OutboundEnvelope } from '@dueloop/messaging';
import { createSmtpChannel } from '../src/index.ts';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const channel = createSmtpChannel({ defaults: { host: '127.0.0.1', port: 54325, secure: false, user: null }, timeoutMs: 5000 });

interface MailpitSummary {
  ID: string;
  MessageID: string;
}
async function find(messageId: string): Promise<MailpitSummary | undefined> {
  const r = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json()) as { messages: MailpitSummary[] };
  return r.messages.find((m) => `<${m.MessageID}>` === messageId);
}

function envelope(key: string, over: { toName?: string; fromName?: string; subject?: string; text?: string } = {}): OutboundEnvelope {
  return {
    tenantId: 't',
    idempotencyKey: key,
    account: {},
    content: {
      kind: 'email',
      to: { address: 'ada@customer.example', name: over.toName ?? 'Ada' },
      from: { address: 'billing@test-co.example', name: over.fromName ?? 'Test Co' },
      subject: over.subject ?? 'Reminder',
      text: over.text ?? 'Hello\n\n--\nReply STOP',
      messageId: `<${key}.${Date.now().toString(36)}.dueloop@test-co.example>`,
    },
  };
}

describe('SMTP adapter -> Mailpit', () => {
  it('delivers a plain-text message with our Message-ID and correct UTF-8 names', async () => {
    const e = envelope('mailpit-utf8', { toName: 'Müller GmbH', fromName: 'Café Ünïcode', subject: 'Rechnung DA-0004 überfällig', text: 'Grüße\n\n--\nAntworten Sie STOP' });
    expect(await channel.send(e, null)).toMatchObject({ kind: 'sent' });
    const m = e.content.kind === 'email' ? await find(e.content.messageId) : undefined;
    expect(m).toBeDefined();
    const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m?.ID}`)).json()) as {
      From: { Name: string; Address: string };
      To: { Name: string; Address: string }[];
      Subject: string;
      Text: string;
      HTML: string;
    };
    expect(full.From).toEqual({ Name: 'Café Ünïcode', Address: 'billing@test-co.example' });
    expect(full.To).toEqual([{ Name: 'Müller GmbH', Address: 'ada@customer.example' }]);
    expect(full.Subject).toBe('Rechnung DA-0004 überfällig');
    // SMTP carries CRLF line endings (RFC 5322); compare the text, not the wire line endings.
    expect(full.Text.replace(/\r\n/g, '\n').trim()).toBe('Grüße\n\n--\nAntworten Sie STOP');
    expect(full.HTML).toBe('');
  });

  it('CRLF injection in names and subject never creates an extra header (sanitised, then encoded)', async () => {
    const hostile = 'Evil\r\nBcc: victim@evil.example\r\nX-Injected: yes';
    const e = envelope('mailpit-crlf', { toName: sanitiseDisplayName(hostile), fromName: sanitiseDisplayName(hostile), subject: sanitiseHeaderValue(`Hi${hostile}`) });
    expect(await channel.send(e, null)).toMatchObject({ kind: 'sent' });
    const m = e.content.kind === 'email' ? await find(e.content.messageId) : undefined;
    const headers = (await (await fetch(`${MAILPIT}/api/v1/message/${m?.ID}/headers`)).json()) as Record<string, string[]>;
    const names = Object.keys(headers).map((h) => h.toLowerCase());
    expect(names).not.toContain('bcc');
    expect(names).not.toContain('x-injected');
    expect(headers['Subject']?.join('')).not.toMatch(/[\r\n]/);
  });

  it('even unsanitised input cannot inject headers (nodemailer encodes; defence in depth)', async () => {
    const e = envelope('mailpit-raw', { toName: 'A\r\nX-Raw-Inject: 1', subject: 'S\r\nX-Raw-Inject: 1' });
    expect(await channel.send(e, null)).toMatchObject({ kind: 'sent' });
    const m = e.content.kind === 'email' ? await find(e.content.messageId) : undefined;
    const headers = (await (await fetch(`${MAILPIT}/api/v1/message/${m?.ID}/headers`)).json()) as Record<string, string[]>;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('x-raw-inject');
  });
});
