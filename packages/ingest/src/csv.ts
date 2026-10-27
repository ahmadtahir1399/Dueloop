import { parse } from 'csv-parse/sync';
import type { Delimiter } from './types.ts';

export type Decoded = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string };

/** Strict UTF-8 (with or without BOM). Invalid bytes are a clear error, never replacement characters. */
export function decodeUtf8(bytes: Uint8Array): Decoded {
  try {
    // ignoreBOM: true keeps a leading U+FEFF in the text so it can be stripped explicitly below.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return { ok: true, text: text.startsWith('\uFEFF') ? text.slice(1) : text };
  } catch {
    return { ok: false, message: 'the file is not valid UTF-8; save it as "CSV UTF-8" and upload again' };
  }
}

const CANDIDATES: readonly Delimiter[] = [',', ';', '\t', '|'];

/** Picks the delimiter that appears most often (outside quotes) in the header line. Ties prefer ','. */
export function detectDelimiter(text: string): Delimiter {
  const counts = new Map<Delimiter, number>(CANDIDATES.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '\n') break;
    else if (!quoted && counts.has(ch as Delimiter)) counts.set(ch as Delimiter, (counts.get(ch as Delimiter) ?? 0) + 1);
  }
  let best: Delimiter = ',';
  for (const d of CANDIDATES) if ((counts.get(d) ?? 0) > (counts.get(best) ?? 0)) best = d;
  return best;
}

export interface CsvRecord {
  /** 1-based line where the record starts in the original file. */
  readonly line: number;
  readonly cells: readonly string[];
}

export type Parsed = { readonly ok: true; readonly records: readonly CsvRecord[] } | { readonly ok: false; readonly message: string };

/**
 * Parses CSV text. Line endings are normalised to \n first (CRLF and lone CR count as one line
 * break, also inside quoted cells), so a record's start line is its end line (csv-parse
 * info.lines) minus the line breaks inside its cells.
 */
export function parseCsv(text: string, delimiter: Delimiter): Parsed {
  const normalised = text.replace(/\r\n?/g, '\n');
  try {
    const out = parse(normalised, {
      delimiter,
      info: true,
      relax_column_count: true,
      skip_empty_lines: true,
      bom: false,
    }) as unknown as { record: string[]; info: { lines: number } }[];
    return {
      ok: true,
      records: out.map(({ record, info }) => ({
        line: info.lines - record.reduce((n, cell) => n + (cell.match(/\n/g)?.length ?? 0), 0),
        cells: record,
      })),
    };
  } catch (e) {
    // csv-parse throws CsvError for malformed input; this boundary turns it into a file-level result.
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
