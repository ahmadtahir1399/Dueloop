// Read-only IMAP poller (prompt 4 step 10, ADR 0031), imapflow 2.9.1. Verified in the installed package:
// mailboxOpen(path, { readOnly: true }) issues EXAMINE, and fetching `source` uses BODY.PEEK[] ("PEEK avoids
// marking messages as \Seen"). So the poller never deletes, moves or changes flags.
// Event id = the Message-ID header (else UIDVALIDITY:UID), so a UIDVALIDITY change re-reads the mailbox
// without creating duplicate events (the store dedupes on the provider event id).
import { ImapFlow } from 'imapflow';

export interface ImapSettings {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly mailbox: string;
}

export interface MailboxCursor {
  readonly uidValidity: string | null;
  readonly lastUid: number;
}

export interface ImapStore {
  cursor(accountId: string): Promise<MailboxCursor>;
  saveCursor(accountId: string, mailbox: string, cursor: MailboxCursor): Promise<void>;
  /** private.store_inbound_event(account, 'imap', eventId, 'message', payload, raw, receivedAt). */
  store(accountId: string, providerEventId: string, payload: Record<string, unknown> | null, rawMime: string | null, receivedAt: Date): Promise<number | null>;
}

/** Messages above this are not downloaded; a marker event becomes a human task (too_large). */
export const MAX_IMAP_BYTES = 2 * 1024 * 1024;

export interface PollResult {
  readonly seen: number;
  readonly stored: number;
  readonly tooLarge: number;
  readonly uidValidityChanged: boolean;
}

export async function pollMailbox(
  settings: ImapSettings,
  password: string,
  accountId: string,
  store: ImapStore,
  now: () => Date,
  timeoutMs = 30_000,
): Promise<PollResult> {
  const client = new ImapFlow({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: password },
    logger: false, // its logs would contain addresses and subjects (rule 25)
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
  await client.connect();
  try {
    const mb = await client.mailboxOpen(settings.mailbox, { readOnly: true });
    const validity = mb.uidValidity.toString();
    const cursor = await store.cursor(accountId);
    const changed = cursor.uidValidity !== null && cursor.uidValidity !== validity;
    const from = changed ? 0 : cursor.lastUid;
    let maxUid = from;
    let seen = 0;
    let stored = 0;
    let tooLarge = 0;
    if (mb.exists > 0) {
      // Sizes and ids first, so oversize messages are never downloaded.
      const heads = await client.fetchAll(`${from + 1}:*`, { uid: true, size: true, envelope: true }, { uid: true });
      for (const h of heads.filter((x) => x.uid > from).sort((a, b) => a.uid - b.uid)) {
        seen++;
        const eventId = h.envelope?.messageId?.trim() || `${validity}:${h.uid}`;
        if ((h.size ?? 0) > MAX_IMAP_BYTES) {
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
    return { seen, stored, tooLarge, uidValidityChanged: changed };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
