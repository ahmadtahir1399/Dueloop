# Pilot playbook

How to run a first pilot so that its result can be measured honestly. Written from the prompt 7 brief (the build
guide's Section 9.4 was not available here). No prices, no sales copy, no promised outcomes.

## Shape

- **Two businesses**, each with its own tenant. Two, because one result can be luck.
- **Approval: always** for the whole pilot (Settings > approval mode). Every reminder is reviewed by a person at the
  business before it goes out; switching to automatic sending is a decision for after the pilot.
- **Thirty days of measurement** after onboarding, compared with a baseline taken before the first reminder.

## Before the first reminder

1. Onboard the business: docs/client-onboarding.md.
2. Import their open invoices (`pnpm import` or the dashboard wizard) and check the overview against their own books.
3. Take the baseline over a period that represents normal business (for example the previous calendar month), in
   the tenant's local dates:

   ```bash
   pnpm pilot:snapshot --tenant <id> --kind baseline --from 2026-09-01 --to 2026-09-30 --client staff_hours_per_week=6
   ```

   `--client` records what only the business knows (hours spent chasing payments, how they estimated it). These rows
   are always shown as client-reported.

## During the pilot

- Weekly: `pnpm ops:status` and `pnpm ops:watchdog` for the operator; a short call with the business about any
  reply that surprised them, any task they disagreed with, and any customer complaint.
- Every unknown message, dispute and "already paid" claim is a human task: make sure someone at the business works
  through them.
- Keep the kill switch drill fresh: the owner should know where it is (Settings) and has tried it once.

## After thirty days

```bash
pnpm pilot:snapshot --tenant <id> --kind periodic --from 2026-10-01 --to 2026-10-30 --client staff_hours_per_week=2
pnpm pilot:report --tenant <id> --csv pilot-report.csv
```

The report compares the baseline with the latest periodic snapshot: overdue balance and invoices, money recovered in
the period, average days to pay, promise-kept rate, messages sent and their cost, and the client-reported rows. It
prints its limits, and the CSV carries them too:

- it is a before/after comparison, not proof of cause;
- the baseline period is a choice and changes the numbers;
- client-reported numbers are not checked by the system;
- amounts are per currency with no conversion;
- nothing may be published without the business's written permission and anonymisation.

## What to write down

The baseline period and why it was chosen, anything unusual in either period (a large customer paying late, a
holiday), every change made to the policy or templates during the pilot, and the business's own view of the result
in their words.
