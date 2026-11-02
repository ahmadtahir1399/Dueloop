// Read-only IMAP poller (prompt 4 step 10, ADR 0031 and 0054), imapflow 2.9.1. Verified in the installed package:
// mailboxOpen(path, { readOnly: true }) issues EXAMINE, and fetching `source` uses BODY.PEEK[] ("PEEK avoids
// marking messages as \Seen"). So the poller never deletes, moves or changes flags.
// Event id = the Message-ID header (else UIDVALIDITY:UID), so a UIDVALIDITY change re-reads recent mail without
// creating duplicate events (the store dedupes on the provider event id).
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { pinnedAddress } from './net-guard.ts';

export interface ImapSettings {
  readonly host: string;
  readonly port: number;
  /** true = implicit TLS (993). false = STARTTLS, which is required: the password never crosses in clear. */
  readonly secure: boolean;
  readonly user: string;
  readonly mailbox: string;
}

export interface MailboxCursor {
  /** null = this mailbox was never read: the first poll only takes a baseline. */
  readonly uidValidity: string | null;
  readonly lastUid: number;
  /** When a poll last completed; a UIDVALIDITY change re-reads from here. */
  readonly savedAt: Date | null;
}

export interface ImapStore {
  cursor(accountId: string): Promise<MailboxCursor>;
  saveCursor(accountId: string, mailbox: string, cursor: Pick<MailboxCursor, 'uidValidity' | 'lastUid'>): Promise<void>;
  /** private.store_inbound_event(account, 'imap', eventId, 'message', payload, raw, receivedAt). */
  store(accountId: string, providerEventId: string, payload: Record<string, unknown> | null, rawMime: string | null, receivedAt: Date): Promise<number | null>;
  /** Is the sender one of this business's customers, or does the message thread to one of our outbound messages? */
  relevant(accountId: string, from: string | null, threadIds: readonly string[]): Promise<boolean>;
}

/** Messages above this are not downloaded; a marker event becomes a human task (too_large). */
export const MAX_IMAP_BYTES = 2 * 1024 * 1024;
/** One poll reads at most this many messages; the cursor picks up the rest on the next poll. */
export const MAX_MESSAGES_PER_POLL = 200;
/** After a UIDVALIDITY change, re-read from the last good poll minus this (IMAP SINCE has day precision). */
const RESYNC_MARGIN_MS = 2 * 86_400_000;
/** Literal cap for a server we do not control: room for the largest message we fetch, plus framing. */
const MAX_LITERAL_BYTES = MAX_IMAP_BYTES + 64 * 1024;

export type MailboxFailure = 'host_refused' | 'login_failed' | 'connect_failed' | 'mailbox_not_found' | 'poll_failed';

/** A failure as a code: server text can echo addresses (rule 20), so it never leaves this file. */
export class MailboxError extends Error {
  readonly code: MailboxFailure;
  constructor(code: MailboxFailure) {
    super(code);
    this.code = code;
  }
}

export interface PollResult {
  readonly seen: number;
  readonly stored: number;
  readonly tooLarge: number;
  /** Not from a customer and not about our messages: never downloaded, never stored. */
  readonly skipped: number;
  readonly uidValidityChanged: boolean;
  readonly baselined: boolean;
}

export interface PollOptions {
  readonly timeoutMs?: number;
  readonly maxMessages?: number;
  /** Injected only by tests, whose server listens on 127.0.0.1. Default: public addresses only (SSRF). */
  readonly addressAllowed?: (ip: string) => boolean;
  /** Injected only by tests, whose server has no TLS. */
  readonly allowPlaintext?: boolean;
}

const MESSAGE_ID = /<[^<>\s]{3,500}>/g;

/** Header-level check, so mail that has nothing to do with collections is never downloaded (data minimisation). */
async function relevant(store: ImapStore, accountId: string, h: FetchMessageObject): Promise<boolean> {
  const from = h.envelope?.from?.[0]?.address?.trim().toLowerCase() ?? null;
  // Bounces come from the mail system, not the customer; the pipeline finds the failed message inside them.
  if (h.bodyStructure?.type?.toLowerCase() === 'multipart/report' || (from !== null && /^(mailer-daemon|postmaster)@/.test(from))) return true;
  const threadIds = `${h.envelope?.inReplyTo ?? ''} ${h.headers?.toString('latin1') ?? ''}`.match(MESSAGE_ID) ?? [];
  return store.relevant(accountId, from, threadIds.slice(0, 50));
}

export async function pollMailbox(settings: ImapSettings, password: string, accountId: string, store: ImapStore, now: () => Date, options: PollOptions = {}): Promise<PollResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const connectTo = await pinnedAddress(settings.host, options.addressAllowed);
  if (connectTo === null) throw new MailboxError('host_refused');
  const client = new ImapFlow({
    host: connectTo,
    servername: settings.host, // TLS still checks the certificate against the name
    port: settings.port,
    secure: settings.secure,
    // imapflow's default falls back to cleartext when STARTTLS is not offered, and it refuses `true` with `secure`.
    doSTARTTLS: settings.secure ? undefined : options.allowPlaintext !== true,
    auth: { user: settings.user, pass: password },
    logger: false, // its logs would contain addresses and subjects (rule 25)
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    disableAutoIdle: true,
    maxLiteralSize: MAX_LITERAL_BYTES,
    maxResponseSize: MAX_LITERAL_BYTES * 2,
  });
  client.on('error', () => undefined); // reported through the failed call; unhandled, it would end the process
  try {
    await client.connect();
  } catch (e) {
    throw new MailboxError((e as { authenticationFailed?: unknown }).authenticationFailed === true ? 'login_failed' : 'connect_failed');
  }
  try {
    const mb = await client.mailboxOpen(settings.mailbox, { readOnly: true }).catch(() => {
      throw new MailboxError('mailbox_not_found');
    });
    const validity = mb.uidValidity.toString();
    const newest = mb.uidNext - 1;
    if (!Number.isSafeInteger(newest) || newest < 0) throw new MailboxError('poll_failed');
    const cursor = await store.cursor(accountId);
    if (cursor.uidValidity === null) {
      // Connecting a mailbox must not feed its history to the classifier, or store it: start from now.
      await store.saveCursor(accountId, settings.mailbox, { uidValidity: validity, lastUid: newest });
      return { seen: 0, stored: 0, tooLarge: 0, skipped: 0, uidValidityChanged: false, baselined: true };
    }
    const changed = cursor.uidValidity !== validity;
    const from = changed ? 0 : cursor.lastUid;
    let maxUid = from;
    let range = `${from + 1}:*`;
    if (changed) {
      // Every UID changed meaning. Only what arrived since the last good poll can be new; re-reading everything
      // would bring back mail from before the baseline, and mail whose event was already purged.
      const since = new Date((cursor.savedAt ?? now()).getTime() - RESYNC_MARGIN_MS);
      const uids = (await client.search({ since }, { uid: true })) || [];
      range = uids.join(',');
      if (uids.length === 0) maxUid = newest;
    }
    let seen = 0;
    let stored = 0;
    let tooLarge = 0;
    let skipped = 0;
    if (mb.exists > 0 && range !== '') {
      // Sizes and ids first, so oversize and unrelated messages are never downloaded.
      const heads = await client.fetchAll(range, { uid: true, size: true, envelope: true, bodyStructure: true, headers: ['references'] }, { uid: true });
      const fresh = heads.filter((x) => x.uid > from).sort((a, b) => a.uid - b.uid);
      for (const h of fresh.slice(0, options.maxMessages ?? MAX_MESSAGES_PER_POLL)) {
        seen++;
        const eventId = h.envelope?.messageId?.trim() || `${validity}:${h.uid}`;
        if (!(await relevant(store, accountId, h))) {
          skipped++;
        } else if ((h.size ?? 0) > MAX_IMAP_BYTES) {
          tooLarge++;
          if ((await store.store(accountId, eventId, { tooLarge: true, size: h.size ?? 0 }, null, now())) !== null) stored++;
        } else {
          const full = await client.fetchOne(String(h.uid), { uid: true, source: true }, { uid: true });
          const raw = full && full.source ? full.source.toString('utf8') : null;
          if (raw !== null && (await store.store(accountId, eventId, null, raw, now())) !== null) stored++;
        }
        maxUid = Math.max(maxUid, h.uid);
        // Advance the cursor as we go: a crash re-reads at most one message, and the store dedupes it.
        await store.saveCursor(accountId, settings.mailbox, { uidValidity: validity, lastUid: maxUid });
      }
    }
    await store.saveCursor(accountId, settings.mailbox, { uidValidity: validity, lastUid: maxUid });
    return { seen, stored, tooLarge, skipped, uidValidityChanged: changed, baselined: false };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
