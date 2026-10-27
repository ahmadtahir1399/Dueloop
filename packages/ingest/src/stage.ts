// Database layer of the import: stage validated rows, then commit them via RPC (one transaction).
// Works with any supabase-js client: the CLI's service-role client, or (later) a signed-in user's.
import { createHash } from 'node:crypto';
import type { Database, Json } from '@dueloop/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportOptions, Mapping, ValidationResult } from './types.ts';

export type Client = SupabaseClient<Database>;

export type StageResult = { readonly ok: true; readonly batchId: string } | { readonly ok: false; readonly error: string };

export interface CommitCounts {
  readonly batchId: string;
  readonly dryRun: boolean;
  readonly invoices: { created: number; updated: number; unchanged: number; skipped: number; errored: number };
  readonly customers: { created: number; updated: number; unchanged: number };
  readonly warnings: readonly { row: number; code: string; message: string }[];
}

export type CommitResult = { readonly ok: true; readonly counts: CommitCounts } | { readonly ok: false; readonly error: string; readonly code?: string };

const CHUNK = 500;

/** Plain, JSON-serialisable data going into a jsonb column. */
const asJson = (value: unknown): NonNullable<Json> => value as NonNullable<Json>;

export async function stageImport(
  client: Client,
  args: {
    readonly tenantId: string;
    readonly uploadedBy: string | null;
    readonly fileName: string;
    readonly bytes: Uint8Array;
    readonly mapping: Mapping;
    readonly options: ImportOptions;
    readonly validation: ValidationResult;
  },
): Promise<StageResult> {
  const { summary } = args.validation;
  if (summary.errors.length > 0) return { ok: false, error: summary.errors.map((e) => `${e.code}: ${e.message}`).join('; ') };

  const batch = await client
    .from('import_batches')
    .insert({
      tenant_id: args.tenantId,
      uploaded_by: args.uploadedBy,
      file_name: args.fileName,
      file_sha256: createHash('sha256').update(args.bytes).digest('hex'),
      mapping: asJson(args.mapping),
      options: asJson({ ...args.options, delimiterUsed: summary.delimiter }),
      counts: {
        rows: summary.rows,
        importable: summary.importable,
        invalid: summary.invalid,
        skipped: summary.skipped,
        warnings: summary.warnings.map((w) => `${w.code}: ${w.message}`),
      },
    })
    .select('id')
    .single();
  if (batch.error) return { ok: false, error: batch.error.message };

  const rows = args.validation.rows.map((r) => ({
    tenant_id: args.tenantId,
    batch_id: batch.data.id,
    row_number: r.line,
    raw: [...r.raw],
    normalised: r.outcome.kind === 'ok' ? asJson(r.outcome.row) : null,
    errors: asJson(r.outcome.kind === 'error' ? r.outcome.errors : []),
    warnings: asJson(r.outcome.kind === 'skipped' ? [] : r.outcome.warnings),
    skip_reason: r.outcome.kind === 'skipped' ? r.outcome.reason : null,
  }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ins = await client.from('import_rows').insert(rows.slice(i, i + CHUNK));
    if (ins.error) return { ok: false, error: ins.error.message };
  }
  return { ok: true, batchId: batch.data.id };
}

/**
 * Commits (or, with dryRun, previews) a staged batch. The database refuses a batch with invalid
 * rows unless skipInvalidRows is passed explicitly; either everything commits or nothing changes.
 */
export async function commitImport(
  client: Client,
  batchId: string,
  opts: { readonly skipInvalidRows?: boolean; readonly dryRun?: boolean } = {},
): Promise<CommitResult> {
  const { data, error } = await client.rpc('commit_import_batch', {
    p_batch_id: batchId,
    p_skip_invalid_rows: opts.skipInvalidRows ?? false,
    p_dry_run: opts.dryRun ?? false,
  });
  if (error) return { ok: false, error: error.message, code: error.code };
  return { ok: true, counts: data as unknown as CommitCounts };
}
