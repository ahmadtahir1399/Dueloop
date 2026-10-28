import "server-only";
import type { TenantContext } from "@/lib/session";

// KPI reads (ADR 0041 functions; RLS applies). Every money value is selected as TEXT (issue I). The functions
// return rows for every tenant the user belongs to, so each read is filtered to the active tenant.

export const BUCKETS = ["not_due", "1-30", "31-60", "61-90", "91+"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABEL: Record<Bucket, string> = {
  not_due: "Not yet due",
  "1-30": "1-30 days overdue",
  "31-60": "31-60 days overdue",
  "61-90": "61-90 days overdue",
  "91+": "Over 90 days overdue",
};

export interface Overview {
  ageing: { currency: string; bucket: Bucket; invoices: number; balance: string }[];
  overdue: { currency: string; invoices: number; balance: string }[];
  recovered: { currency: string; recovered: string; receipts: number; credit: string }[];
  daysToPay: { invoices: number; avgDaysToPay: string | null; avgDaysAfterDue: string | null } | null;
  promise: { kept: number; broken: number; rate: string | null } | null;
  messages: { purpose: string; channel: string; sent: number; cost: string }[];
  invoiceCount: number;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error || r.data === null) throw new Error(`could not load ${what}`);
  return r.data;
}

export async function loadOverview(ctx: TenantContext, from: string, to: string): Promise<Overview> {
  const sb = ctx.supabase;
  const t = ctx.tenant.id;
  const [ageing, overdue, recovered, days, promise, messages, count] = await Promise.all([
    sb.rpc("kpi_ageing", {}).select("tenant_id, currency, bucket, invoices, balance::text").eq("tenant_id", t),
    sb.rpc("kpi_overdue_total", {}).select("tenant_id, currency, invoices, balance::text").eq("tenant_id", t),
    sb.rpc("kpi_recovered", { p_from: from, p_to: to }).select("tenant_id, currency, recovered::text, receipts, credit::text").eq("tenant_id", t),
    sb.rpc("kpi_days_to_pay", { p_from: from, p_to: to }).select("tenant_id, invoices, avg_days_to_pay::text, avg_days_after_due::text").eq("tenant_id", t),
    sb.rpc("kpi_promise_kept_rate", { p_from: from, p_to: to }).select("tenant_id, kept, broken, rate::text").eq("tenant_id", t),
    sb.rpc("kpi_messages", { p_from: from, p_to: to }).select("tenant_id, purpose, channel, sent, cost_minor::text").eq("tenant_id", t),
    sb.from("invoices").select("id", { count: "exact", head: true }).eq("tenant_id", t),
  ]);
  const d = must(days, "days to pay")[0];
  const p = must(promise, "promise rate")[0];
  if (count.error) throw new Error("could not count invoices");
  return {
    ageing: must(ageing, "ageing").map((r) => ({ currency: r.currency, bucket: r.bucket as Bucket, invoices: Number(r.invoices), balance: r.balance })),
    overdue: must(overdue, "overdue").map((r) => ({ currency: r.currency, invoices: Number(r.invoices), balance: r.balance })),
    recovered: must(recovered, "recovered").map((r) => ({ currency: r.currency, recovered: r.recovered, receipts: Number(r.receipts), credit: r.credit })),
    daysToPay: d ? { invoices: Number(d.invoices), avgDaysToPay: d.avg_days_to_pay, avgDaysAfterDue: d.avg_days_after_due } : null,
    promise: p ? { kept: Number(p.kept), broken: Number(p.broken), rate: p.rate } : null,
    messages: must(messages, "messages").map((r) => ({ purpose: r.purpose, channel: r.channel, sent: Number(r.sent), cost: r.cost_minor })),
    invoiceCount: count.count ?? 0,
  };
}
