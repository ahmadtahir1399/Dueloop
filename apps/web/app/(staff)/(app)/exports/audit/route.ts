// Audit export (issue Q): owner/accountant, a tenant-local date range, capped. One RPC returns the rows AND logs
// AuditExported (who, range, row count) in the same transaction; payloads are scrubbed in the database.
import { can } from "@dueloop/authz";
import { DateTime } from "luxon";
import { csvResponse, EXPORT_MAX_ROWS } from "@/lib/csv";
import { requireTenant } from "@/lib/session";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const ctx = await requireTenant();
  if (!can(ctx.role, "export.audit")) return new Response("Not found", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return new Response("Choose a valid date range.", { status: 400 });
  // Inclusive local days [from, to] in the tenant zone -> [from 00:00, to+1 00:00) as instants.
  const start = DateTime.fromISO(from, { zone: ctx.tenant.timezone }).startOf("day");
  const end = DateTime.fromISO(to, { zone: ctx.tenant.timezone }).startOf("day").plus({ days: 1 });
  if (!start.isValid || !end.isValid || end <= start) return new Response("Choose a valid date range.", { status: 400 });
  const { data, error } = await ctx.supabase.rpc("audit_export", {
    p_tenant: ctx.tenant.id,
    p_from: start.toUTC().toISO() ?? "",
    p_to: end.toUTC().toISO() ?? "",
    p_max: EXPORT_MAX_ROWS,
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return new Response("Export failed.", { status: error?.code === "42501" ? 404 : 500 });
  const rows = Array.isArray((data as { rows?: unknown }).rows) ? ((data as { rows: Record<string, unknown>[] }).rows) : [];
  const tz = ctx.tenant.timezone;
  async function* gen() {
    for (const r of rows) {
      const at = typeof r.at === "string" ? DateTime.fromISO(r.at, { setZone: true }).setZone(tz).toFormat("yyyy-MM-dd HH:mm:ss") : "";
      yield [at, String(r.scope ?? ""), String(r.invoice_number ?? ""), String(r.type ?? ""), String(r.key ?? ""), JSON.stringify(r.payload ?? {})];
    }
    if ((data as { truncated?: boolean }).truncated) yield ["", "", "", "TRUNCATED", "", `capped at ${EXPORT_MAX_ROWS} rows: narrow the range`];
  }
  return csvResponse(`audit-${from}-to-${to}.csv`, [`time (${tz})`, "scope", "invoice_number", "event", "key", "details"], gen());
}
