// Golden fixtures: each file's full validation result is snapshotted to fixtures/expected/<name>.json
// (reviewed by hand), and the key behaviours are also asserted explicitly below.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_ROWS } from '../src/limits.ts';
import { errorReportCsv } from '../src/report.ts';
import type { ImportOptions, Mapping, RowResult, ValidationResult } from '../src/types.ts';
import { identityKey, validateFile } from '../src/validate.ts';
import { seeded } from './random.ts';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const bytes = (f: string) => new Uint8Array(readFileSync(path.join(dir, f)));
const jsonFile = <T>(f: string): T => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as T;

const CASES: Record<string, { mapping: string; options: string }> = {
  clean: { mapping: 'standard', options: 'gb-ymd' },
  'messy-eu': { mapping: 'eu', options: 'de-dmy' },
  'messy-us': { mapping: 'us', options: 'us-mdy' },
  duplicates: { mapping: 'standard', options: 'pk-dmy' },
  i18n: { mapping: 'standard', options: 'pk-ymd' },
  'bad-dates': { mapping: 'standard', options: 'gb-dmy' },
  'no-contact': { mapping: 'standard', options: 'gb-ymd' },
  hostile: { mapping: 'standard', options: 'gb-ymd' },
  'invalid-utf8': { mapping: 'standard', options: 'gb-ymd' },
};

function run(name: string): ValidationResult {
  const c = CASES[name];
  if (!c) throw new Error(`no case ${name}`);
  return validateFile(
    bytes(`${name}.csv`),
    jsonFile<Mapping>(`mappings/${c.mapping}.json`),
    jsonFile<ImportOptions>(`options/${c.options}.json`),
    seeded(42),
  );
}

const codes = (r: RowResult | undefined) => {
  const o = r?.outcome;
  if (!o) return null;
  if (o.kind === 'skipped') return { kind: o.kind };
  return { kind: o.kind, errors: o.kind === 'error' ? o.errors.map((e) => e.code) : [], warnings: o.warnings.map((w) => w.code) };
};

describe('golden fixture snapshots', () => {
  it.each(Object.keys(CASES))('%s', async (name) => {
    await expect(`${JSON.stringify(run(name), null, 2)}\n`).toMatchFileSnapshot(path.join(dir, 'expected', `${name}.json`));
  });
  it('hostile error report', async () => {
    await expect(errorReportCsv(run('hostile'))).toMatchFileSnapshot(path.join(dir, 'expected', 'hostile.report.csv'));
  });
});

describe('fixture behaviours (explicit)', () => {
  it('clean: 3 importable, the Paid row skipped, Acme twice with one identity', () => {
    const r = run('clean');
    expect(r.summary).toMatchObject({ rows: 4, importable: 3, invalid: 0, skipped: 1, delimiter: ',', delimiterDetected: true });
    const keys = r.rows.flatMap((x) => (x.outcome.kind === 'ok' ? [identityKey(x.outcome.row.customer)] : []));
    expect(keys).toEqual(['ext:C-001', 'ext:C-002', 'ext:C-001']);
  });

  it('messy-eu: BOM + ";" + decimal comma + DMY; "1.250,00 EUR" = 125000 cents; 3 decimals rejected', () => {
    const r = run('messy-eu');
    expect(r.summary).toMatchObject({ delimiter: ';', importable: 3, invalid: 1 });
    expect(r.summary.header[0]).toBe('Rechnungsnr'); // BOM stripped
    const ok = r.rows.flatMap((x) => (x.outcome.kind === 'ok' ? [x.outcome.row] : []));
    expect(ok.map((x) => [x.invoiceNumber, x.amountMinor, x.currency, x.issuedOn])).toEqual([
      ['RE-2026-01', 125000, 'EUR', '2026-09-01'],
      ['RE-2026-02', 1250050, 'EUR', '2026-09-03'],
      ['RE-2026-03', 125000, 'EUR', '2026-09-10'],
    ]);
    expect(ok[1]?.customer.email).toBe('info@schroeder.example');
    expect(codes(r.rows[3])).toMatchObject({ kind: 'error', errors: ['excess_decimals'] });
  });

  it('messy-us: MDY, "$1,250.00", status skips case-insensitively, negative is an error', () => {
    const r = run('messy-us');
    expect(r.summary).toMatchObject({ importable: 3, invalid: 1, skipped: 2 });
    expect(r.rows[0]?.outcome.kind === 'ok' && r.rows[0].outcome.row).toMatchObject({ amountMinor: 125000, issuedOn: '2026-09-01', dueOn: '2026-10-15' });
    expect(codes(r.rows[4])).toMatchObject({ errors: ['non_positive_amount'] });
    expect(codes(r.rows[5])).toMatchObject({ kind: 'ok', warnings: ['due_before_issued'] });
  });

  it('duplicates: repeated numbers flag BOTH rows; three phone formats share one identity; name never merges', () => {
    const r = run('duplicates');
    expect(codes(r.rows[5])).toMatchObject({ kind: 'error', errors: ['duplicate_invoice_number'] });
    expect(codes(r.rows[6])).toMatchObject({ kind: 'error', errors: ['duplicate_invoice_number'] });
    const ok = r.rows.flatMap((x) => (x.outcome.kind === 'ok' ? [x.outcome.row] : []));
    expect(new Set(ok.slice(0, 3).map((x) => identityKey(x.customer)))).toEqual(new Set(['phone:+923001234567']));
    expect(ok.slice(0, 3).map((x) => x.amountMinor)).toEqual([10000000, 5000000, 2500050]); // PKR 1,00,000 Indian grouping
    expect(codes(r.rows[3])?.warnings).toContain('same_name_different_customer');
    expect(identityKey(ok[5]?.customer ?? { name: '', email: null, phone: null, externalId: null })).toBe('email:billing@acme.example');
    expect(identityKey(ok[6]?.customer ?? { name: '', email: null, phone: null, externalId: null })).toBe('email:billing@acme.example');
  });

  it('i18n: names preserved byte for byte; KWD 3 decimals; JPY none; mixed currencies warned', () => {
    const r = run('i18n');
    const names = r.rows.flatMap((x) => (x.outcome.kind === 'ok' ? [x.outcome.row.customer.name] : []));
    expect(names).toEqual(['Müller & Söhne', 'شركة الأمل للتجارة', 'عمران ٹریڈرز', 'Café 😀 Ltd', 'Zoë Ørsted']);
    const amounts = r.rows.flatMap((x) => (x.outcome.kind === 'ok' ? [`${x.outcome.row.amountMinor} ${x.outcome.row.currency}`] : []));
    expect(amounts).toEqual(['10000 EUR', '250000 KWD', '15000000 PKR', '99 JPY', '1050 EUR']);
    expect(r.summary.warnings.map((w) => w.code)).toContain('mixed_currencies');
  });

  it('bad-dates: 31/02 and ISO-under-DMY are errors, Excel serials read, ambiguity warned', () => {
    const r = run('bad-dates');
    expect(codes(r.rows[0])).toMatchObject({ errors: ['invalid_date'] });
    expect(r.rows[2]?.outcome.kind === 'ok' && r.rows[2].outcome.row.issuedOn).toBe('2026-04-01');
    expect(codes(r.rows[3])).toMatchObject({ errors: ['invalid_date'] });
    expect(r.rows[4]?.outcome.kind === 'ok' && r.rows[4].outcome.row.issuedOn).toBe('2026-02-01');
    expect(codes(r.rows[5])).toMatchObject({ errors: ['invalid_date'] });
    expect(r.summary.warnings.map((w) => w.code)).toEqual(['date_format_unconfirmed']);
  });

  it('no-contact: importable with warnings; invalid email/phone become warnings and nulls', () => {
    const r = run('no-contact');
    expect(r.summary.importable).toBe(3);
    expect(codes(r.rows[0])?.warnings).toEqual(['no_contact_method']);
    expect(codes(r.rows[1])?.warnings).toEqual(['invalid_email', 'invalid_phone', 'no_contact_method']);
  });

  it('hostile: line numbers survive multi-line cells; oversized cell is an error; the report defuses every formula', () => {
    const r = run('hostile');
    expect(r.rows.map((x) => x.line)).toEqual([2, 3, 6, 7, 8]);
    expect(codes(r.rows[2])).toMatchObject({ errors: ['cell_too_long'] });
    const report = errorReportCsv(r);
    const cells = [...report.matchAll(/(?:^|,|\r\n)"((?:[^"]|"")*)"/g)].map((m) => (m[1] ?? '').replace(/""/g, '"'));
    expect(cells.length).toBeGreaterThan(20);
    for (const c of cells) expect(c, c).not.toMatch(/^\s*[=+\-@\t\r\n＝＋－＠]/);
    expect(report.startsWith('\uFEFF')).toBe(true);
  });

  it('invalid-utf8: a clear file-level error, no rows', () => {
    const r = run('invalid-utf8');
    expect(r.summary.errors.map((e) => e.code)).toEqual(['invalid_utf8']);
    expect(r.rows).toEqual([]);
  });

  it('oversized file and too many rows fail before any row work', () => {
    const mapping = jsonFile<Mapping>('mappings/standard.json');
    const options = jsonFile<ImportOptions>('options/gb-ymd.json');
    const big = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61);
    expect(validateFile(big, mapping, options, seeded(1)).summary.errors.map((e) => e.code)).toEqual(['file_too_large']);
    const line = 'X,Name,,,"1",GBP,2026-01-01,2026-02-01,,Open';
    const many = new TextEncoder().encode(['invoice_no,customer,email,phone,amount,currency,issued,due,customer_id,status', ...Array(MAX_ROWS + 1).fill(line)].join('\n'));
    expect(validateFile(many, mapping, options, seeded(1)).summary.errors.map((e) => e.code)).toEqual(['too_many_rows']);
  });

  it('options are explicit: an unknown date format or country is a file error, not a guess', () => {
    const mapping = jsonFile<Mapping>('mappings/standard.json');
    const bad = { ...jsonFile<ImportOptions>('options/gb-ymd.json'), dateFormat: 'auto', defaultCountry: 'XX' } as unknown as ImportOptions;
    expect(validateFile(bytes('clean.csv'), mapping, bad, seeded(1)).summary.errors.map((e) => e.code)).toEqual(['invalid_options']);
  });

  it('a mapping naming a missing column is a file error', () => {
    const mapping = { ...jsonFile<Mapping>('mappings/standard.json'), email: 'E-mail address' };
    const r = validateFile(bytes('clean.csv'), mapping, jsonFile<ImportOptions>('options/gb-ymd.json'), seeded(1));
    expect(r.summary.errors.map((e) => e.code)).toEqual(['missing_columns']);
  });
});
