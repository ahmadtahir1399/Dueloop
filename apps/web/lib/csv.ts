// CSV exports (rule 14, issue Q): every cell goes through ingest's neutraliseCell (formula neutralisation, quoting),
// UTF-8 with a BOM, CRLF lines, streamed so a large list never sits in memory, capped at EXPORT_MAX_ROWS.
import { neutraliseCell } from "@dueloop/ingest";

export const EXPORT_MAX_ROWS = 50_000;
const BOM = String.fromCharCode(0xfeff); // so spreadsheet apps read the file as UTF-8

export const csvLine = (cells: readonly (string | number | null | undefined)[]) => `${cells.map((c) => neutraliseCell(c === null || c === undefined ? "" : String(c))).join(",")}\r\n`;

/** A streamed CSV response. `rows` yields cell arrays; `onDone` receives the row count (for the export log). */
export function csvResponse(filename: string, header: string[], rows: AsyncIterable<(string | number | null)[]>, onDone?: (count: number) => Promise<void>): Response {
  const enc = new TextEncoder();
  const it = rows[Symbol.asyncIterator]();
  let count = 0;
  let started = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(enc.encode(BOM + csvLine(header)));
        return;
      }
      const next = await it.next();
      if (next.done) {
        if (onDone) await onDone(count);
        controller.close();
        return;
      }
      count++;
      controller.enqueue(enc.encode(csvLine(next.value)));
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
