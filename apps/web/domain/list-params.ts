// List filter state (redesign §4.10, v1.2): the URL is the source of truth. Each list page parses its search params
// with one of these schemas on the server. Unknown or bad values fall back to the default (`.catch`), so a hand-edited
// or stale link never crashes a page. Param NAMES are the ones the server already reads (q, status, bucket, customer,
// opted_out, period, and the cursor `after`), so existing links and CSV exports keep working (CONFLICTS C-50).
// The data queries keep their own parsers (lib/data/*: parseFilters, parseCustomerFilters): these schemas describe the
// UI's view of the same params and never widen what reaches the database.
import { z } from "zod";
import { isPeriodKey, type PeriodKey } from "../lib/time";
import { InvoiceStatus, LIST_BUCKETS } from "./invoice";

/** Select sentinel for "no filter": Radix Select rejects "" as a value (§4.10 rule 11). Never put in a URL. */
export const ALL = "all";

/** Cursor params: any filter change drops them, so the list starts again at its first page (§4.10 rule 2). */
export const CURSOR_KEYS = ["after", "before", "page"] as const;

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: unknown) => (typeof v === "string" ? v : undefined);
const text = (max: number) =>
  z.preprocess(one, z.string().trim().max(max).optional())
    .transform((s) => (s ? s : undefined))
    .catch(undefined);
const cursor = z.preprocess(one, z.string().max(400).optional()).catch(undefined);

export const InvoiceListParams = z.object({
  q: text(60),
  status: z.preprocess(one, z.union([InvoiceStatus, z.literal(ALL)])).catch(ALL),
  bucket: z.preprocess(one, z.union([z.enum(LIST_BUCKETS), z.literal(ALL)])).catch(ALL),
  customer: z.preprocess(one, z.uuid().optional()).catch(undefined),
  after: cursor,
});
export type InvoiceListParams = z.infer<typeof InvoiceListParams>;

export const CustomerListParams = z.object({
  q: text(60),
  opted_out: z.preprocess(one, z.literal("1").optional()).catch(undefined),
  after: cursor,
});
export type CustomerListParams = z.infer<typeof CustomerListParams>;

export const TaskListParams = z.object({ status: z.preprocess(one, z.enum(["open", "resolved"])).catch("open") });
export type TaskListParams = z.infer<typeof TaskListParams>;

export const ProofListParams = z.object({ status: z.preprocess(one, z.enum(["pending", "confirmed", "rejected"])).catch("pending") });
export type ProofListParams = z.infer<typeof ProofListParams>;

export const OverviewParams = z.object({
  period: z.preprocess(one, z.custom<PeriodKey>(isPeriodKey)).catch("this_month" as PeriodKey),
});
export type OverviewParams = z.infer<typeof OverviewParams>;

/** Parse a page's searchParams; never throws. */
export function parseListParams<S extends z.ZodType>(schema: S, sp: SearchParams): z.output<S> {
  return schema.parse(sp);
}
