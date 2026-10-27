// Error report export. Every cell is untrusted and is neutralised against spreadsheet formula
// injection following OWASP "CSV Injection" (www-community, revision 35884b9, 2026-01-29):
// cells starting with = + - @, tab, CR, LF, or the full-width ＝ ＋ － ＠ get a leading single quote,
// every cell is wrapped in double quotes, and embedded double quotes are doubled.
// Leading whitespace is ignored when looking for a dangerous first character, so " =cmd" is caught too.
import type { RowResult, ValidationResult } from './types.ts';

const DANGEROUS_START = /^[=+\-@\t\r\n＝＋－＠]/;

export function neutraliseCell(value: string): string {
  const defused = DANGEROUS_START.test(value) || DANGEROUS_START.test(value.replace(/^[ \u00A0]+/, '')) ? `'${value}` : value;
  return `"${defused.replace(/"/g, '""')}"`;
}

const line = (cells: readonly string[]) => cells.map(neutraliseCell).join(',');

function describe(r: RowResult): { errors: string; warnings: string } {
  const o = r.outcome;
  if (o.kind === 'skipped') return { errors: '', warnings: `skipped: ${o.reason}` };
  const fmt = (xs: readonly { code: string; message: string; column?: string }[]) =>
    xs.map((x) => `${x.code}${x.column ? ` [${x.column}]` : ''}: ${x.message}`).join('; ');
  return { errors: o.kind === 'error' ? fmt(o.errors) : '', warnings: fmt(o.warnings) };
}

/**
 * CSV of every row with an error or warning: the original cells plus line, errors and warnings
 * columns. UTF-8 with a BOM (so spreadsheet apps keep non-ASCII names) and CRLF line endings.
 */
export function errorReportCsv(result: ValidationResult): string {
  const header = [...result.summary.header, 'import_line', 'import_errors', 'import_warnings'];
  const out = [line(header)];
  for (const issue of [...result.summary.errors, ...result.summary.warnings]) {
    out.push(line([...result.summary.header.map(() => ''), 'file', result.summary.errors.includes(issue) ? `${issue.code}: ${issue.message}` : '', result.summary.errors.includes(issue) ? '' : `${issue.code}: ${issue.message}`]));
  }
  for (const r of result.rows) {
    const d = describe(r);
    if (d.errors === '' && d.warnings === '') continue;
    const cells = result.summary.header.map((_, i) => r.raw[i] ?? '');
    out.push(line([...cells, String(r.line), d.errors, d.warnings]));
  }
  return `\uFEFF${out.join('\r\n')}\r\n`;
}
