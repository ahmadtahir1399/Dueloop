// What the poller refuses before any password leaves the process. A scripted IMAP server on 127.0.0.1 records every
// command it receives, so "the password was never sent" is checked on the wire.
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailboxError, pollMailbox, type ImapStore, type PollOptions } from '../src/index.ts';

const PASSWORD = 'hunter2-the-mailbox-password';
const now = () => new Date('2026-11-02T10:00:00Z');
const store: ImapStore = {
  cursor: async () => ({ uidValidity: null, lastUid: 0, savedAt: null }),
  saveCursor: async () => undefined,
  store: async () => null,
  relevant: async () => false,
};

const servers: { close(): void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** Answers CAPABILITY and LOGIN only: enough for imapflow to reach (or refuse) the login. */
async function imapServer(capabilities: string, login: string): Promise<{ port: number; lines: string[] }> {
  const lines: string[] = [];
  const sockets: Socket[] = [];
  const server = createServer((s) => {
    sockets.push(s);
    s.on('error', () => undefined);
    s.write(`* OK [CAPABILITY ${capabilities}] ready\r\n`);
    s.on('data', (d) => {
      for (const line of d.toString('latin1').split('\r\n').filter(Boolean)) {
        lines.push(line);
        const [tag, cmd] = line.split(' ');
        if (cmd === 'CAPABILITY') s.write(`* CAPABILITY ${capabilities}\r\n${tag} OK done\r\n`);
        else if (cmd === 'LOGIN') s.write(`${tag} ${login}\r\n`);
        else s.write(`${tag} BAD unexpected\r\n`);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push({ close: () => (sockets.forEach((s) => s.destroy()), server.close()) });
  return { port: (server.address() as AddressInfo).port, lines };
}

const poll = (port: number, options: PollOptions = {}) =>
  pollMailbox({ host: '127.0.0.1', port, secure: false, user: 'billing', mailbox: 'INBOX' }, PASSWORD, 'account', store, now, { timeoutMs: 2000, addressAllowed: () => true, ...options });

const failure = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: unknown) => (e instanceof MailboxError ? e.code : `not a MailboxError: ${String(e)}`),
  );

describe('pollMailbox refuses before the password is sent', () => {
  it.each(['127.0.0.1', 'localhost'])('an internal host (%s) is refused without connecting (SSRF)', async (host) => {
    const s = await imapServer('IMAP4rev1 AUTH=PLAIN', 'OK welcome');
    const r = pollMailbox({ host, port: s.port, secure: false, user: 'billing', mailbox: 'INBOX' }, PASSWORD, 'account', store, now);
    expect(await failure(r)).toBe('host_refused');
    expect(s.lines).toEqual([]);
  });

  it('a server that does not offer STARTTLS never sees the login (no downgrade)', async () => {
    const s = await imapServer('IMAP4rev1 AUTH=PLAIN', 'OK welcome');
    expect(await failure(poll(s.port))).toBe('connect_failed');
    expect(s.lines.join('\n')).not.toContain(PASSWORD);
    expect(s.lines.some((l) => l.includes('LOGIN'))).toBe(false);
  });

  it('a refused login is a code; the server text is not in the error', async () => {
    const s = await imapServer('IMAP4rev1 AUTH=PLAIN', 'NO [AUTHENTICATIONFAILED] no such user billing@customer.example');
    const r = poll(s.port, { allowPlaintext: true });
    await expect(r).rejects.toThrow(MailboxError);
    const message = await r.catch((e: Error) => e.message);
    expect(message).toBe('login_failed');
  });

  it('a connection that drops mid-session is a rejected poll, not an unhandled error event', async () => {
    const onUncaught = vi.fn();
    process.on('uncaughtException', onUncaught);
    const server = createServer((s) => {
      s.write('* OK ready\r\n');
      s.once('data', () => s.destroy());
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    expect(await failure(poll((server.address() as AddressInfo).port, { allowPlaintext: true }))).toBe('connect_failed');
    process.off('uncaughtException', onUncaught);
    expect(onUncaught).not.toHaveBeenCalled();
  });
});
