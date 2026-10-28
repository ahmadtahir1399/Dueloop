# 0031: IMAP poller, MIME parsing and the test server

**Choices** (one line each, after checking the installed packages):
- **IMAP client: imapflow 2.9.1.** Its `mailboxOpen(path, { readOnly: true })` issues EXAMINE, and its
  `source` fetch uses `BODY.PEEK[]` (verified in `dist/esm/commands/fetch.js`), so we can never set `\Seen`.
  UIDVALIDITY is a bigint on the mailbox, and it is maintained (same author as nodemailer).
- **MIME parser: postal-mime 4.1.4.** No dependencies, all headers available (needed for RFC 3834/3464),
  hard limits on part count, nesting and header size, and attachments as data we reduce to metadata.
- **HTML to text: html-to-text 10.0.1.** It converts and never renders; scripts, styles, images and link
  targets are dropped.
- **Test server: GreenMail 2.1.14** (`greenmail/standalone`, Docker). It runs in CI via `docker run`,
  configured per its docs (`-Dgreenmail.setup.test.all`, `-Dgreenmail.users=login:pwd@domain`, IMAP on
  3143).

**Poller.**
- Read-only: it never deletes, moves or changes flags.
- The cursor is (UIDVALIDITY, last UID) in `private.imap_cursors`, advanced per message.
- The event id is the Message-ID header (else `UIDVALIDITY:UID`). After a UIDVALIDITY change the mailbox is
  re-read and the store's dedupe prevents duplicate events (tested).
- Messages over 2 MB are never downloaded; a marker event becomes an `unprocessed_inbound` task.
- The mailbox password is the email channel account's Vault secret (the same app password as SMTP).

**Real mailboxes** need app passwords or provider-specific setup (many providers disable password IMAP
by default). The Gmail API with push notifications is a later option; Google's OAuth app verification can
take weeks (guide Part 5). IMAP against a real provider is NOT VERIFIED here.
