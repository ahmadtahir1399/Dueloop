# 0054: Reading customer email replies in production

**Context.** The IMAP poller (ADR 0031) was built and tested, but no command ran it and there was no way to connect a
mailbox, so email replies never reached the inbox. Running the poller as it stood would have done harm: its first
poll started at UID 1 and read a mailbox's whole history into the classifier.

**Decision.** A `mailbox` service (`pnpm mailbox --loop`, compose service `mailbox`) polls every connected mailbox
once a minute and stores events through `private.store_inbound_event`. The existing processor does the rest, so an
email reply takes the same path as a WhatsApp reply. Nothing in the poller can send a message or change an invoice.

**Operator switch.** `IMAP_ALLOW_TENANT_HOST=true` turns the form and the polling on, separately from
`SMTP_ALLOW_TENANT_HOST`: it is a different reason to connect to a host a business chose. Unset, the service idles
and the screen says replies are not read.

**Settings a client cannot write.**
- Host, port, login and folder are in `channel_accounts.imap_config`, not `config`. `config` is client-writable (0026),
  so an owner could PATCH a host through the API and have the poller send the stored password to their own server,
  which would make a write-only secret readable.
- The password is its own Vault secret (`imap_secret_id`). The channel's `secret_id` is the SMTP password, and
  `smtpLogin` prefers it over the operator's `SMTP_PASSWORD`, so sharing it would break sending on the operator's relay.
- `private.set_mailbox` is the only writer. It refuses to keep the saved password when the host or login changes.
  Changing the mailbox or folder deletes the cursor, because UIDs mean nothing across mailboxes.
- `external_account_id` stays empty for email. WhatsApp needs it for routing and Meta proves ownership first. Here,
  nothing routes by it, knowing the password is the proof, and a unique claim would let a business squat on a mailbox.

**What is read.**
- The first poll only records the newest UID. Mail from before connecting is never read, stored or classified.
- Mail is checked from its headers first. Only mail from one of this business's customers, mail threading to one of
  its outbound messages, and delivery reports (`multipart/report`, or from `mailer-daemon@` / `postmaster@`) are
  downloaded. Anything else stays in the mailbox and never reaches our database, so a shared mailbox's newsletters do
  not become tasks or PII here. The cost: a new contact writing fresh from an unknown address is not seen by the app.
  It stays in the business's mailbox, which the poller never changes.
- After a UIDVALIDITY change, only mail since the last good poll (minus two days, as IMAP SINCE has day precision) is
  re-read. ADR 0031 re-read everything; that would bring back mail from before the baseline, and mail whose event was
  already purged, for which dedupe cannot help.
- At most 200 messages per poll; the cursor carries the rest to the next one.

**Connecting safely.** Same guard as SMTP (`pinnedAddress`): resolve once, refuse internal addresses, connect to that
address, check TLS against the host name. Port 993 is implicit TLS; 143 sets `doSTARTTLS: true`, because imapflow's
default continues in cleartext when STARTTLS is not offered (verified in `dist/esm/types.d.ts`, 2.9.1). imapflow
rejects `doSTARTTLS: true` together with `secure: true`, so it is set only for 143. The form offers those two ports
only. Host and TLS are enforced again at connection time, whatever the form or the database says.
`client.on('error')` is required: without a listener, a dropped connection would end the process. Literal and
response sizes are capped, as a business's server is not ours to trust.

**Failure.** Each mailbox fails alone. Failures are codes (`private.imap_cursors.last_error`, never the server's words:
they can echo addresses), shown in Settings > Integrations in plain words. Backoff doubles from 2 minutes to 1 hour,
as repeated bad logins get accounts locked. After 3 failures in a row the business is alerted, at most once a day,
because a silent failure means reminders keep going to customers who already answered.

**Reply-To.** A sender on a relay (Resend, for instance) may have no mailbox behind it, so replies would have nowhere
to land. `config.reply_to` adds a Reply-To header to reminders and receipts. It is also treated as an own address
(loop detection). It stays in `config`, so it is checked with `isSafeAddress` at send time.

**The email footer still does not say "reply STOP".** Reading replies is optional per business and per server, so the
footer cannot promise it. The opt-out link and the one-click header stay the way to stop.

**Not verified.** Tested against GreenMail and scripted servers. No real provider has been connected. Many need an
app password and IMAP switched on (ADR 0031).
