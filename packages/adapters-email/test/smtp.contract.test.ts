// Contract test against a scripted in-process SMTP server: every way a session can end maps to exactly one
// SendOutcome, and "the server may have the message" is always ambiguous.
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { OutboundEnvelope } from '@dueloop/messaging';
import { classifySmtpError, createSmtpChannel } from '../src/index.ts';

type Phase = 'greeting' | 'ehlo' | 'mail' | 'rcpt' | 'data' | 'body';
type Script = Partial<Record<Phase, string | 'close' | 'hang'>>;

const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A minimal SMTP responder. Unscripted phases answer the happy path. Records the received DATA. */
async function smtp(script: Script = {}): Promise<{ port: number; received: string[] }> {
  const received: string[] = [];
  const server = net.createServer((sock) => {
    sock.on('error', () => undefined);
    const reply = (phase: Phase, ok: string) => {
      const s = script[phase] ?? ok;
      if (s === 'close') sock.destroy();
      else if (s !== 'hang') sock.write(`${s}\r\n`);
    };
    let inData = false;
    let body = '';
    let buf = '';
    reply('greeting', '220 test ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(body);
            reply('body', '250 OK queued');
          } else body += `${line}\n`;
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) reply('ehlo', '250 test');
        else if (cmd.startsWith('MAIL FROM')) reply('mail', '250 OK');
        else if (cmd.startsWith('RCPT TO')) reply('rcpt', '250 OK');
        else if (cmd === 'DATA') {
          const s = script.data;
          if (s === undefined || s.startsWith('354')) inData = true;
          reply('data', '354 go ahead');
        } else if (cmd === 'QUIT') {
          sock.end('221 bye\r\n');
        } else sock.write('250 OK\r\n');
      }
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, received };
}

const envelope = (port: number): OutboundEnvelope => ({
  tenantId: 't',
  idempotencyKey: 'inv-1:s1:email',
  account: { smtp_host: '127.0.0.1', smtp_port: port },
  content: {
    kind: 'email',
    to: { address: 'ada@customer.example', name: 'Ada' },
    from: { address: 'billing@test-co.example', name: 'Test Co' },
    subject: 'Reminder INV-1',
    text: 'Hi Ada,\n\n--\nReply STOP',
    messageId: '<inv-1.s1.email.dueloop@test-co.example>',
  },
});

const channel = createSmtpChannel({ defaults: null, timeoutMs: 400 });

describe('SMTP adapter contract', () => {
  it('250 after the body -> sent, with our own Message-ID on the wire', async () => {
    const s = await smtp();
    const r = await channel.send(envelope(s.port), null);
    expect(r).toEqual({ kind: 'sent', providerMessageId: '<inv-1.s1.email.dueloop@test-co.example>' });
    expect(s.received[0]).toMatch(/^Message-ID: <inv-1\.s1\.email\.dueloop@test-co\.example>$/m);
    expect(s.received[0]).toMatch(/^Content-Type: text\/plain/m);
  });

  it.each<[string, Script, string, string]>([
    ['550 at RCPT', { rcpt: '550 5.1.1 no such user' }, 'permanent', 'smtp_550'],
    ['451 at MAIL', { mail: '451 4.7.1 try later' }, 'not_sent_retryable', 'smtp_451'],
    ['421 greeting', { greeting: '421 too busy' }, 'not_sent_retryable', 'smtp_421'],
    ['554 after the body', { body: '554 5.7.1 rejected as spam' }, 'permanent', 'smtp_554'],
    ['452 after the body', { body: '452 4.3.1 storage' }, 'not_sent_retryable', 'smtp_452'],
    ['connection dropped after the body (before 250)', { body: 'close' }, 'ambiguous', 'smtp_econnection'],
    ['server silent after the body', { body: 'hang' }, 'ambiguous', 'smtp_etimedout'],
  ])('%s -> %s', async (_name, script, kind, reason) => {
    const s = await smtp(script);
    expect(await channel.send(envelope(s.port), null)).toEqual({ kind, reason });
  });

  it('connection refused -> not sent, retryable', async () => {
    const s = await smtp();
    await Promise.all(servers.splice(0).map((x) => new Promise((r) => x.close(r))));
    expect(await channel.send(envelope(s.port), null)).toEqual({ kind: 'not_sent_retryable', reason: 'smtp_econnrefused' });
  });

  it('no SMTP configured -> not sent, retryable; wrong content -> permanent', async () => {
    const e = envelope(1);
    expect(await channel.send({ ...e, account: {} }, null)).toEqual({ kind: 'not_sent_retryable', reason: 'smtp_not_configured' });
    expect(await channel.send({ ...e, content: { kind: 'whatsapp_template', to: '+1', templateName: 'x', languageCode: 'en', parameters: [] } }, null)).toMatchObject({ kind: 'permanent' });
  });

  it('a mid-session socket error tagged CONN is NOT treated as not-sent', () => {
    expect(classifySmtpError({ code: 'ESOCKET', originalCode: 'ECONNRESET', command: 'CONN' })).toEqual({ kind: 'ambiguous', reason: 'smtp_esocket' });
    expect(classifySmtpError(new Error('weird'))).toMatchObject({ kind: 'ambiguous' });
    expect(classifySmtpError({ code: 'EAUTH', command: 'AUTH PLAIN' })).toMatchObject({ kind: 'not_sent_retryable' });
  });

  it('reasons are codes only: no server text, no addresses (rule 20)', async () => {
    const s = await smtp({ rcpt: '550 5.1.1 <ada@customer.example> unknown' });
    const r = await channel.send(envelope(s.port), null);
    expect(JSON.stringify(r)).not.toContain('@');
  });
});
