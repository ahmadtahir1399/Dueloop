// Import contracts shared by the pure layer, the staging/commit layer, the CLI and (later) the UI.

/** Which CSV header feeds each field. Data, not code. */
export interface Mapping {
  readonly invoiceNumber: string;
  readonly customerName: string;
  readonly total: string;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly email?: string;
  readonly phone?: string;
  /** Column holding an ISO 4217 code; without it, a code in the amount cell or defaultCurrency is used. */
  readonly currency?: string;
  readonly externalCustomerId?: string;
  /** Rows whose status cell (trimmed, case-insensitive) is one of skipValues are not imported. */
  readonly status?: { readonly column: string; readonly skipValues: readonly string[] };
}

export type Delimiter = ',' | ';' | '\t' | '|';
export type DateFormat = 'DMY' | 'MDY' | 'YMD';

/** Every option is explicit. Nothing is guessed silently; auto-detection is reported in the summary. */
export interface ImportOptions {
  readonly delimiter: Delimiter | 'auto';
  readonly decimal: '.' | ',';
  /** REQUIRED. Never inferred from the data. */
  readonly dateFormat: DateFormat;
  /** ISO 3166-1 alpha-2, used to read national phone numbers. */
  readonly defaultCountry: string;
  readonly defaultCurrency: string;
  /** Tenant IANA zone, recorded with the batch (dates in the file are calendar dates). */
  readonly timezone: string;
}

export type Severity = 'error' | 'warning';

export interface Issue {
  readonly code: IssueCode;
  readonly message: string;
  readonly column?: string;
}

export type IssueCode =
  // file level
  | 'file_too_large'
  | 'invalid_utf8'
  | 'empty_file'
  | 'csv_syntax'
  | 'missing_columns'
  | 'too_many_rows'
  | 'invalid_options'
  | 'date_format_unconfirmed'
  | 'mixed_currencies'
  // row errors
  | 'wrong_column_count'
  | 'cell_too_long'
  | 'missing_value'
  | 'invalid_amount'
  | 'non_positive_amount'
  | 'excess_decimals'
  | 'amount_too_large'
  | 'unknown_currency'
  | 'currency_conflict'
  | 'invalid_date'
  | 'duplicate_invoice_number'
  // row warnings
  | 'currency_differs_from_file'
  | 'due_before_issued'
  | 'invalid_email'
  | 'invalid_phone'
  | 'no_contact_method'
  | 'same_name_different_customer';

export interface NormalisedRow {
  readonly invoiceNumber: string;
  readonly customer: {
    readonly name: string;
    readonly email: string | null;
    readonly phone: string | null;
    readonly externalId: string | null;
  };
  readonly amountMinor: number;
  readonly currency: string;
  readonly issuedOn: string;
  readonly dueOn: string;
  /** Candidates tried in order by the commit step on a reference-code clash (ADR 0010). */
  readonly referenceCodes: readonly string[];
}

export type RowOutcome =
  | { readonly kind: 'ok'; readonly row: NormalisedRow; readonly warnings: readonly Issue[] }
  | { readonly kind: 'error'; readonly errors: readonly Issue[]; readonly warnings: readonly Issue[] }
  | { readonly kind: 'skipped'; readonly reason: string };

export interface RowResult {
  /** 1-based line of the original file where this record starts (header is line 1). */
  readonly line: number;
  readonly raw: readonly string[];
  readonly outcome: RowOutcome;
}

export interface FileSummary {
  readonly delimiter: Delimiter;
  readonly delimiterDetected: boolean;
  readonly header: readonly string[];
  readonly rows: number;
  readonly importable: number;
  readonly invalid: number;
  readonly skipped: number;
  readonly errors: readonly Issue[];
  readonly warnings: readonly Issue[];
}

export interface ValidationResult {
  readonly summary: FileSummary;
  readonly rows: readonly RowResult[];
}

/** Integer in [0, n). Injected so tests are deterministic; the CLI passes a crypto source. */
export type RandomInt = (n: number) => number;
