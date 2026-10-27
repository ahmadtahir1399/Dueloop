// pnpm import --tenant <uuid> --file <csv> --mapping <json> [--options <json>] [--dry-run]
//             [--skip-invalid] [--error-report out.csv]
// Without --options, pass --date-format DMY|MDY|YMD and --country XX; the tenant's currency and
// time zone are then used, with '.' decimals and auto-detected delimiter.
// Credentials: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment only. Never printed.
import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@dueloop/db';
import { errorReportCsv } from './report.ts';
import { commitImport, stageImport, type CommitCounts } from './stage.ts';
import type { DateFormat, ImportOptions, Mapping, ValidationResult } from './types.ts';
import { validateFile } from './validate.ts';

const USAGE =
  'Usage: pnpm import --tenant <uuid> --file <csv> --mapping <json> [--options <json> | --date-format DMY|MDY|YMD --country XX]\n' +
  '                   [--dry-run] [--skip-invalid] [--error-report out.csv]\n';

function printSummary(v: ValidationResult): void {
  const s = v.summary;
  console.log(`File: ${s.rows} rows | importable ${s.importable} | invalid ${s.invalid} | skipped ${s.skipped}`);
  console.log(`Delimiter: ${JSON.stringify(s.delimiter)}${s.delimiterDetected ? ' (auto-detected)' : ''}`);
  for (const w of s.warnings) console.log(`  file warning ${w.code}: ${w.message}`);
  for (const e of s.errors) console.log(`  FILE ERROR ${e.code}: ${e.message}`);
  for (const r of v.rows) {
    if (r.outcome.kind === 'error') console.log(`  line ${r.line}: ${r.outcome.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}`);
  }
}

function printCounts(c: CommitCounts): void {
  const i = c.invoices;
  const k = c.customers;
  console.log(`${c.dryRun ? 'DRY RUN (nothing written)' : 'COMMITTED'} batch ${c.batchId}`);
  console.log(`  invoices : created ${i.created} | updated ${i.updated} | unchanged ${i.unchanged} | skipped ${i.skipped} | errored ${i.errored}`);
  console.log(`  customers: created ${k.created} | updated ${k.updated} | unchanged ${k.unchanged}`);
  for (const w of c.warnings) console.log(`  line ${w.row}: ${w.code}: ${w.message}`);
}

async function main(argv: readonly string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        tenant: { type: 'string' },
        file: { type: 'string' },
        mapping: { type: 'string' },
        options: { type: 'string' },
        'date-format': { type: 'string' },
        country: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'skip-invalid': { type: 'boolean', default: false },
        'error-report': { type: 'string' },
      },
      strict: true,
    }));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (!values.tenant || !values.file || !values.mapping) {
    process.stderr.write(USAGE);
    return 2;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    process.stderr.write('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (see README).\n');
    return 2;
  }
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const tenant = await client.from('tenants').select('id, currency, timezone').eq('id', values.tenant).maybeSingle();
  if (tenant.error || !tenant.data) {
    process.stderr.write(`Tenant ${values.tenant} not found${tenant.error ? `: ${tenant.error.message}` : ''}\n`);
    return 1;
  }

  let options: ImportOptions;
  if (values.options) {
    options = JSON.parse(readFileSync(values.options, 'utf8')) as ImportOptions;
  } else {
    if (!values['date-format'] || !values.country) {
      process.stderr.write('Without --options, --date-format and --country are required (the date format is never guessed).\n');
      return 2;
    }
    options = {
      delimiter: 'auto',
      decimal: '.',
      dateFormat: values['date-format'] as DateFormat,
      defaultCountry: values.country,
      defaultCurrency: tenant.data.currency,
      timezone: tenant.data.timezone,
    };
  }
  const mapping = JSON.parse(readFileSync(values.mapping, 'utf8')) as Mapping;
  const bytes = new Uint8Array(readFileSync(values.file));

  const validation = validateFile(bytes, mapping, options, randomInt);
  printSummary(validation);
  if (values['error-report']) {
    writeFileSync(values['error-report'], errorReportCsv(validation));
    console.log(`Error report written to ${values['error-report']}`);
  }

  const staged = await stageImport(client, {
    tenantId: values.tenant,
    uploadedBy: null,
    fileName: path.basename(values.file),
    bytes,
    mapping,
    options,
    validation,
  });
  if (!staged.ok) {
    console.error(`Not staged: ${staged.error}`);
    return 1;
  }
  const result = await commitImport(client, staged.batchId, { skipInvalidRows: values['skip-invalid'], dryRun: values['dry-run'] });
  if (!result.ok) {
    console.error(`Commit refused: ${result.error}`);
    return 1;
  }
  printCounts(result.counts);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
