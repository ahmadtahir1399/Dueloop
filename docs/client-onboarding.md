# Client onboarding checklist

One copy per client. Each item names who does it and where; "the business" means the client, "operator" the person
running this software for them. Nothing here is legal advice.

## Accounts and sending

- [ ] **Email domain authentication** (the business, with their DNS provider): SPF, DKIM and DMARC records for the
      sending domain, so reminders are not marked as spam. Record which records were added and when.
- [ ] **Sending account** (operator: SMTP host and user in the server env; owner, Settings > Integrations: the
      SMTP password and the "Email sender" address on the authenticated domain). Send one test reminder to an
      address the business controls.
- [ ] **WhatsApp** (the business with Meta, only if used): business verification, a phone number for the WhatsApp
      Cloud API, and approved message templates. Template approval is Meta's decision and takes time; plan for it.
- [ ] **Payment account** (the business, only if used): connect their own Stripe account (Settings > Integrations,
      restricted key and webhook signing secret), or confirm bank-transfer details for the reminder text.
- [ ] **Alerts** (operator): Slack webhook or the owners' email; check one alert arrives.

## Data

- [ ] **Import file:** an export from their accounting tool. Agree the column mapping, the date format (day/month or
      month/day) and the decimal separator; run the import as a dry run first and read the error report with them.
- [ ] **Time zone and holidays:** the tenant's IANA time zone and their public holidays (Settings > Holidays), so
      reminders respect local quiet hours.
- [ ] **Opt-in evidence:** for each channel, how the business obtained permission to contact their customers that
      way. Record it on each customer's page ("Record consent"). WhatsApp steps are skipped for customers without
      a recorded WhatsApp consent; email does not require one.
- [ ] **Monthly budget for WhatsApp:** Settings, above 0 if WhatsApp is used (0 blocks WhatsApp and SMS).

## Policy and approvals

- [ ] **Reminder policy and templates** reviewed by the business: wording, tone, steps and days after due. They own
      what is said to their customers.
- [ ] **Approval mode: always** for the pilot (docs/pilot-playbook.md).
- [ ] **Roles:** who is owner, accountant, collector (Settings > Members). At least two owners if possible.

## Legal and safety

- [ ] **Legal review in their market** (the business and their adviser): debt-collection and consumer-contact rules,
      data protection, what may be said in a reminder. This software does not decide that. <!-- claims-ok: disclaimer -->
- [ ] **Kill switch drill** (the owner): pause sending in Settings, confirm nothing goes out, resume.
- [ ] **Monitoring hookup** (operator): `/ready` checks and the watchdog schedule (docs/runbook.md "Health").
- [ ] **Data lifecycle** explained: retention periods (ADR 0051), how a customer's data is exported or erased
      (`pnpm customer export|erase`), and that backups do not contain provider credentials.

## Baseline

- [ ] `pnpm pilot:snapshot --kind baseline` taken before the first reminder (docs/pilot-playbook.md).
