"use server";

// Import wizard actions. Everything runs as the signed-in user: staging goes through RLS (owner and
// accountant only) and commit_import_batch checks the role again inside the database.
import { randomInt } from "node:crypto";
import {
  MAX_FILE_BYTES,
  commitImport,
  decodeUtf8,
  detectDelimiter,
  errorReportCsv,
  parseCsv,
  stageImport,
  validateFile,
  type CommitCounts,
  type ImportOptions,
  type Issue,
  type Mapping,
} from "@dueloop/ingest";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canImport, requireTenant, type TenantContext } from "@/lib/session";

export type ColumnsResult = { ok: true; header: string[]; delimiter: string; fileName: string } | { ok: false; error: string };

export interface RowIssue {
  line: number;
  errors: string[];
  warnings: string[];
}

export type PreviewResult =
  | {
      ok: true;
      batchId: string;
      rows: number;
      importable: number;
      invalid: number;
      skipped: number;
      delimiter: string;
      fileWarnings: string[];
      issues: RowIssue[];
      counts: CommitCounts;
    }
  | { ok: false; error: string };

export type CommitResultView = { ok: true; counts: CommitCounts } | { ok: false; error: string };

const mappingSchema = z.object({
  invoiceNumber: z.string().min(1),
  customerName: z.string().min(1),
  total: z.string().min(1),
  issuedOn: z.string().min(1),
  dueOn: z.string().min(1),
  email: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  externalCustomerId: z.string().min(1).optional(),
  status: z.object({ column: z.string().min(1), skipValues: z.array(z.string()) }).optional(),
});

const optionsSchema = z.object({
  delimiter: z.enum([",", ";", "\t", "|", "auto"]),
  decimal: z.enum([".", ","]),
  dateFormat: z.enum(["DMY", "MDY", "YMD"], { error: "Choose the date format used in the file." }),
  defaultCountry: z.string().regex(/^[A-Z]{2}$/, { error: "Use a 2-letter country code, e.g. PK." }),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1),
});

const fmt = (xs: readonly Issue[]) => xs.map((x) => `${x.message}${x.column ? ` [${x.column}]` : ""}`);

async function readFile(formData: FormData): Promise<{ bytes: Uint8Array; name: string } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > MAX_FILE_BYTES) return { error: `The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name };
}

async function allowedContext(): Promise<{ ctx: TenantContext } | { error: string }> {
  const ctx = await requireTenant();
  if (!canImport(ctx.role)) return { error: "Only owners and accountants can import invoices." };
  return { ctx };
}

/** Step 1: read the header so the user can map columns. */
export async function readColumns(formData: FormData): Promise<ColumnsResult> {
  const allowed = await allowedContext();
  if ("error" in allowed) return { ok: false, error: allowed.error };
  const file = await readFile(formData);
  if ("error" in file) return { ok: false, error: file.error };
  const decoded = decodeUtf8(file.bytes);
  if (!decoded.ok) return { ok: false, error: decoded.message };
  const delimiter = detectDelimiter(decoded.text);
  const firstLine = decoded.text.split(/\r\n?|\n/, 1)[0] ?? "";
  const parsed = parseCsv(firstLine, delimiter);
  if (!parsed.ok || !parsed.records[0]) return { ok: false, error: "Could not read a header row." };
  return { ok: true, header: parsed.records[0].cells.map((c) => c.trim()), delimiter, fileName: file.name };
}

function parseInputs(formData: FormData): { mapping: Mapping; options: ImportOptions } | { error: string } {
  try {
    const mapping = mappingSchema.safeParse(JSON.parse(String(formData.get("mapping") ?? "{}")));
    if (!mapping.success) return { error: "Map every required column (invoice number, customer, total, issued and due dates)." };
    const options = optionsSchema.safeParse(JSON.parse(String(formData.get("options") ?? "{}")));
    if (!options.success) return { error: options.error.issues[0]?.message ?? "Check the import options." };
    return { mapping: mapping.data as Mapping, options: options.data };
  } catch {
    return { error: "The mapping or options could not be read." };
  }
}

/** Step 2: validate, stage and dry-run. Nothing reaches invoices or customers yet. */
export async function previewImport(formData: FormData): Promise<PreviewResult> {
  const allowed = await allowedContext();
  if ("error" in allowed) return { ok: false, error: allowed.error };
  const { ctx } = allowed;
  const file = await readFile(formData);
  if ("error" in file) return { ok: false, error: file.error };
  const inputs = parseInputs(formData);
  if ("error" in inputs) return { ok: false, error: inputs.error };

  const validation = validateFile(file.bytes, inputs.mapping, { ...inputs.options, timezone: ctx.tenant.timezone }, randomInt);
  const s = validation.summary;
  if (s.errors.length > 0) return { ok: false, error: fmt(s.errors).join(" ") };

  const staged = await stageImport(ctx.supabase, {
    tenantId: ctx.tenant.id,
    uploadedBy: ctx.userId,
    fileName: file.name,
    bytes: file.bytes,
    mapping: inputs.mapping,
    options: { ...inputs.options, timezone: ctx.tenant.timezone },
    validation,
  });
  if (!staged.ok) return { ok: false, error: staged.error };

  // The dry run always previews the valid rows; committing still needs an explicit "skip invalid rows".
  const dry = await commitImport(ctx.supabase, staged.batchId, { dryRun: true, skipInvalidRows: true });
  if (!dry.ok) return { ok: false, error: dry.error };

  const issues: RowIssue[] = validation.rows
    .filter((r) => r.outcome.kind === "error" || (r.outcome.kind === "ok" && r.outcome.warnings.length > 0))
    .slice(0, 200)
    .map((r) => ({
      line: r.line,
      errors: r.outcome.kind === "error" ? fmt(r.outcome.errors) : [],
      warnings: r.outcome.kind === "skipped" ? [] : fmt(r.outcome.warnings),
    }));

  return {
    ok: true,
    batchId: staged.batchId,
    rows: s.rows,
    importable: s.importable,
    invalid: s.invalid,
    skipped: s.skipped,
    delimiter: s.delimiter,
    fileWarnings: fmt(s.warnings),
    issues,
    counts: dry.counts,
  };
}

/** Step 3: commit the staged batch in one transaction. */
export async function commitBatch(batchId: string, skipInvalidRows: boolean): Promise<CommitResultView> {
  const allowed = await allowedContext();
  if ("error" in allowed) return { ok: false, error: allowed.error };
  if (!z.uuid().safeParse(batchId).success) return { ok: false, error: "Unknown import." };
  const r = await commitImport(allowed.ctx.supabase, batchId, { skipInvalidRows });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/", "layout");
  return { ok: true, counts: r.counts };
}

/** A spreadsheet-safe CSV of every row with an error or warning (formula cells are defused). */
export async function errorReport(formData: FormData): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const allowed = await allowedContext();
  if ("error" in allowed) return { ok: false, error: allowed.error };
  const file = await readFile(formData);
  if ("error" in file) return { ok: false, error: file.error };
  const inputs = parseInputs(formData);
  if ("error" in inputs) return { ok: false, error: inputs.error };
  const validation = validateFile(file.bytes, inputs.mapping, { ...inputs.options, timezone: allowed.ctx.tenant.timezone }, randomInt);
  return { ok: true, csv: errorReportCsv(validation) };
}
