// Pure validation pipeline: bytes + mapping + options -> per-row outcome + file summary. No database.
import { currencyExponent, isIanaZone } from '@dueloop/core';
import { parseAmount } from './amount.ts';
import { isCountry, normaliseEmail, normalisePhone } from './contact.ts';
import { decodeUtf8, detectDelimiter, parseCsv } from './csv.ts';
import { parseDate } from './date.ts';
import { MAX_CELL_CHARS, MAX_FILE_BYTES, MAX_ROWS, REFERENCE_CANDIDATES } from './limits.ts';
import { generateReferenceCode } from './reference.ts';
import type {
  Delimiter,
  FileSummary,
  ImportOptions,
  Issue,
  Mapping,
  NormalisedRow,
  RandomInt,
  RowResult,
  ValidationResult,
} from './types.ts';

const fileError = (issue: Issue, delimiter: Delimiter = ',', detected = false): ValidationResult => ({
  summary: { delimiter, delimiterDetected: detected, header: [], rows: 0, importable: 0, invalid: 0, skipped: 0, errors: [issue], warnings: [] },
  rows: [],
});

function checkOptions(o: ImportOptions): Issue | null {
  const bad: string[] = [];
  if (!['DMY', 'MDY', 'YMD'].includes(o.dateFormat)) bad.push('dateFormat must be DMY, MDY or YMD');
  if (o.decimal !== '.' && o.decimal !== ',') bad.push("decimal must be '.' or ','");
  if (!isCountry(o.defaultCountry)) bad.push(`unknown defaultCountry "${o.defaultCountry}"`);
  if (!currencyExponent(o.defaultCurrency).ok) bad.push(`unknown defaultCurrency "${o.defaultCurrency}"`);
  if (!isIanaZone(o.timezone)) bad.push(`timezone "${o.timezone}" is not an IANA zone`);
  return bad.length ? { code: 'invalid_options', message: bad.join('; ') } : null;
}

/** Customer identity in precedence order: external id, then normalised email, then E.164 phone. */
export function identityKey(c: NormalisedRow['customer']): string | null {
  if (c.externalId) return `ext:${c.externalId}`;
  if (c.email) return `email:${c.email}`;
  if (c.phone) return `phone:${c.phone}`;
  return null;
}

export function validateFile(bytes: Uint8Array, mapping: Mapping, options: ImportOptions, random: RandomInt): ValidationResult {
  // b. Limits and options before any heavy work.
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return fileError({ code: 'file_too_large', message: `file is ${bytes.byteLength} bytes; the limit is ${MAX_FILE_BYTES}` });
  }
  const optionIssue = checkOptions(options);
  if (optionIssue) return fileError(optionIssue);

  // a. Encoding.
  const decoded = decodeUtf8(bytes);
  if (!decoded.ok) return fileError({ code: 'invalid_utf8', message: decoded.message });
  if (decoded.text.trim() === '') return fileError({ code: 'empty_file', message: 'the file has no content' });

  const detected = options.delimiter === 'auto';
  const delimiter = detected ? detectDelimiter(decoded.text) : (options.delimiter as Delimiter);
  const parsed = parseCsv(decoded.text, delimiter);
  if (!parsed.ok) return fileError({ code: 'csv_syntax', message: parsed.message }, delimiter, detected);

  const [headerRecord, ...records] = parsed.records;
  const header = (headerRecord?.cells ?? []).map((h) => h.trim());
  if (records.length > MAX_ROWS) {
    return fileError({ code: 'too_many_rows', message: `${records.length} rows; the limit is ${MAX_ROWS}` }, delimiter, detected);
  }

  const wanted = [
    mapping.invoiceNumber, mapping.customerName, mapping.total, mapping.issuedOn, mapping.dueOn,
    mapping.email, mapping.phone, mapping.currency, mapping.externalCustomerId, mapping.status?.column,
  ].filter((c): c is string => c !== undefined);
  const missing = [...new Set(wanted)].filter((c) => !header.includes(c));
  if (missing.length > 0) {
    const r = fileError({ code: 'missing_columns', message: `mapped columns not in the header: ${missing.join(', ')}` }, delimiter, detected);
    return { ...r, summary: { ...r.summary, header } };
  }
  const col = (name: string | undefined) => (name === undefined ? -1 : header.indexOf(name));
  const idx = {
    number: col(mapping.invoiceNumber), name: col(mapping.customerName), total: col(mapping.total),
    issued: col(mapping.issuedOn), due: col(mapping.dueOn), email: col(mapping.email), phone: col(mapping.phone),
    currency: col(mapping.currency), ext: col(mapping.externalCustomerId), status: col(mapping.status?.column),
  };
  const skipValues = new Set((mapping.status?.skipValues ?? []).map((v) => v.trim().toLowerCase()));
  const country = options.defaultCountry;
  if (!isCountry(country)) return fileError({ code: 'invalid_options', message: 'defaultCountry' }); // narrowed above

  let dateConfirmed = false;
  let datesSeen = 0;
  const rows: RowResult[] = records.map((rec) => {
    const cell = (i: number) => (i < 0 ? '' : (rec.cells[i] ?? ''));
    const errors: Issue[] = [];
    const warnings: Issue[] = [];

    if (rec.cells.length !== header.length) {
      errors.push({ code: 'wrong_column_count', message: `expected ${header.length} cells, found ${rec.cells.length}` });
    }
    const long = rec.cells.findIndex((c) => c.length > MAX_CELL_CHARS);
    if (long >= 0) {
      errors.push({ code: 'cell_too_long', message: `a cell is longer than ${MAX_CELL_CHARS} characters`, column: header[long] ?? `#${long + 1}` });
    }
    if (errors.length > 0) return { line: rec.line, raw: rec.cells, outcome: { kind: 'error', errors, warnings } };

    if (idx.status >= 0 && skipValues.has(cell(idx.status).trim().toLowerCase())) {
      return { line: rec.line, raw: rec.cells, outcome: { kind: 'skipped', reason: `status "${cell(idx.status).trim()}"` } };
    }

    const invoiceNumber = cell(idx.number).trim();
    if (invoiceNumber === '') errors.push({ code: 'missing_value', message: 'invoice number is empty', column: mapping.invoiceNumber });
    const name = cell(idx.name).trim(); // non-ASCII preserved exactly: only surrounding whitespace is trimmed
    if (name === '') errors.push({ code: 'missing_value', message: 'customer name is empty', column: mapping.customerName });

    // c. Amount and currency.
    const columnCurrency = idx.currency >= 0 && cell(idx.currency).trim() !== '' ? cell(idx.currency).trim().toUpperCase() : null;
    let currency = '';
    const amount = parseAmount(cell(idx.total), options.decimal, (inCell) => {
      currency = columnCurrency ?? inCell ?? options.defaultCurrency;
      return currency;
    });
    if (!amount.ok) errors.push({ ...amount.issue, column: mapping.total });
    else if (columnCurrency && amount.currencyInCell && amount.currencyInCell !== columnCurrency) {
      errors.push({ code: 'currency_conflict', message: `amount says ${amount.currencyInCell}, currency column says ${columnCurrency}`, column: mapping.total });
    }

    // d. Dates.
    const issued = parseDate(cell(idx.issued), options.dateFormat);
    const due = parseDate(cell(idx.due), options.dateFormat);
    for (const [d, column] of [[issued, mapping.issuedOn], [due, mapping.dueOn]] as const) {
      if (!d.ok) errors.push({ ...d.issue, column });
      else if (!d.excelSerial) {
        datesSeen++;
        if (d.confirmsFormat) dateConfirmed = true;
      }
    }
    if (issued.ok && due.ok && due.iso < issued.iso) {
      warnings.push({ code: 'due_before_issued', message: `due ${due.iso} is before issued ${issued.iso}` });
    }

    // e. Contact details: problems are warnings, never row failures.
    const email = idx.email >= 0 ? normaliseEmail(cell(idx.email)) : { email: null, invalid: false };
    if (email.invalid) warnings.push({ code: 'invalid_email', message: `ignored invalid email "${cell(idx.email).trim()}"`, column: mapping.email ?? '' });
    const phone = idx.phone >= 0 ? normalisePhone(cell(idx.phone), country) : { phone: null, invalid: false };
    if (phone.invalid) warnings.push({ code: 'invalid_phone', message: `ignored invalid phone "${cell(idx.phone).trim()}"`, column: mapping.phone ?? '' });
    if (!email.email && !phone.phone) warnings.push({ code: 'no_contact_method', message: 'no usable email or phone; the customer cannot be contacted' });

    if (errors.length > 0 || !amount.ok || !issued.ok || !due.ok) {
      return { line: rec.line, raw: rec.cells, outcome: { kind: 'error', errors, warnings } };
    }
    const externalId = idx.ext >= 0 && cell(idx.ext).trim() !== '' ? cell(idx.ext).trim() : null;
    const row: NormalisedRow = {
      invoiceNumber,
      customer: { name, email: email.email, phone: phone.phone, externalId },
      amountMinor: amount.minor,
      currency,
      issuedOn: issued.iso,
      dueOn: due.iso,
      referenceCodes: Array.from({ length: REFERENCE_CANDIDATES }, () => generateReferenceCode(random)),
    };
    return { line: rec.line, raw: rec.cells, outcome: { kind: 'ok', row, warnings } };
  });

  // h. Duplicate invoice numbers within the file: every copy is an error, none is imported.
  const byNumber = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const n = r.outcome.kind === 'skipped' ? '' : (r.raw[idx.number] ?? '').trim();
    if (n !== '') byNumber.set(n, [...(byNumber.get(n) ?? []), i]);
  });
  for (const [n, list] of byNumber) {
    if (list.length < 2) continue;
    const lines = list.map((i) => rows[i]?.line).join(', ');
    for (const i of list) {
      const r = rows[i];
      if (!r) continue;
      const issue: Issue = { code: 'duplicate_invoice_number', message: `invoice number "${n}" appears on lines ${lines}`, column: mapping.invoiceNumber };
      const prev = r.outcome;
      const errs = prev.kind === 'error' ? [...prev.errors, issue] : [issue];
      const warns = prev.kind === 'skipped' ? [] : prev.warnings;
      rows[i] = { ...r, outcome: { kind: 'error', errors: errs, warnings: warns } };
    }
  }

  // c. Currency disagreeing with the rest of the file: a warning, never silent.
  const counts = new Map<string, number>();
  for (const r of rows) if (r.outcome.kind === 'ok') counts.set(r.outcome.row.currency, (counts.get(r.outcome.row.currency) ?? 0) + 1);
  const fileWarnings: Issue[] = [];
  if (counts.size > 1) {
    const major = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '';
    fileWarnings.push({ code: 'mixed_currencies', message: `rows use ${[...counts.keys()].sort().join(', ')}; most use ${major}` });
    rows.forEach((r, i) => {
      if (r.outcome.kind === 'ok' && r.outcome.row.currency !== major) {
        rows[i] = { ...r, outcome: { ...r.outcome, warnings: [...r.outcome.warnings, { code: 'currency_differs_from_file', message: `${r.outcome.row.currency} differs from the file's ${major}` }] } };
      }
    });
  }

  // d. If no day-of-month value exceeds 12, DMY vs MDY cannot be confirmed from the data.
  if (options.dateFormat !== 'YMD' && datesSeen > 0 && !dateConfirmed) {
    fileWarnings.push({
      code: 'date_format_unconfirmed',
      message: `every day value is 12 or less, so the data cannot confirm ${options.dateFormat}; check the preview (03/04/2026 is ${options.dateFormat === 'DMY' ? '3 April' : 'March 4'})`,
    });
  }

  // f. Name alone never merges customers, but the same name with a different identity is flagged.
  const idsByName = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.outcome.kind !== 'ok') continue;
    const key = identityKey(r.outcome.row.customer) ?? `row:${r.line}`;
    const nameKey = r.outcome.row.customer.name.toLowerCase();
    idsByName.set(nameKey, new Set([...(idsByName.get(nameKey) ?? []), key]));
  }
  rows.forEach((r, i) => {
    if (r.outcome.kind !== 'ok') return;
    const ids = idsByName.get(r.outcome.row.customer.name.toLowerCase());
    if (ids && ids.size > 1) {
      rows[i] = { ...r, outcome: { ...r.outcome, warnings: [...r.outcome.warnings, { code: 'same_name_different_customer', message: `"${r.outcome.row.customer.name}" also appears with other contact details; kept as separate customers` }] } };
    }
  });

  const summary: FileSummary = {
    delimiter,
    delimiterDetected: detected,
    header,
    rows: rows.length,
    importable: rows.filter((r) => r.outcome.kind === 'ok').length,
    invalid: rows.filter((r) => r.outcome.kind === 'error').length,
    skipped: rows.filter((r) => r.outcome.kind === 'skipped').length,
    errors: [],
    warnings: fileWarnings,
  };
  return { summary, rows };
}
