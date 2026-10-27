# 0010: Import rules

**Context.** Clients live in spreadsheets: messy encodings, local number and date formats, the same customer
spelled three ways. A bad file must never half-import, and importing the same file twice must change nothing.

**Decision.** The flow is validate (pure, `packages/ingest`) -> stage (`import_batches`, `import_rows`) ->
dry run or commit (`public.commit_import_batch`, one transaction).

**Validation (pure).**
- UTF-8 only (BOM optional). Limits: 5 MiB, 10,000 rows, 1,000 characters per cell.
- The date format is required and never guessed. If no day value exceeds 12, a preview warning says DMY/MDY
  cannot be confirmed.
- Amounts are parsed with strings and BigInt. Western and Indian digit grouping are accepted. The decimal
  places follow ISO 4217. Zero, negative and excess decimals are row errors.
- Phones become E.164 using the tenant's country, and an invalid phone is a warning. A row with no contact
  method is importable with a warning.
- Customer identity, in order: external id, then email, then phone. A name alone never merges customers;
  the same name with a different identity gets a warning.
- Duplicate invoice numbers in one file flag every copy, and none is imported.

**Commit.**
- Who: service role, or owner/accountant (checked inside the function).
- Locking: a per-tenant advisory lock serialises overlapping commits.
- Invalid rows: refused unless `skipInvalidRows`.
- New invoices: `open`, `next_action_at = now()` (due immediately; issue H), a reference code, and an
  `InvoiceImported` event (key `import:<invoice id>`).
- Existing invoices (matched by tenant + number): only `issued_on`, `due_on` and `amount_total` change.
  Nothing changes when the invoice is final, its currency differs, or the new total would be below the
  confirmed payments. `InvoiceImportUpdated` is written only on a real change.
- Existing customers: empty contact fields are filled; differences are reported, never overwritten.
- Reference codes: ingest generates 7 random symbols plus a Luhn mod 30 check symbol over an unambiguous
  alphabet, five candidates per row, with randomness injected. Commit tries them in order on a unique clash;
  if all five are taken the whole commit fails.

**Consequences.** Dry-run batches stay `staged` and are never cleaned up yet (retention is out of scope).
The rules are pure functions and one SQL function, so the future upload UI and REST endpoint can reuse
them.
