import "server-only";
import { ageingBucket, daysOverdue, type AgeingBucket } from "@/lib/format";
import type { TenantContext } from "@/lib/session";

export interface InvoiceListItem {
  id: string;
  number: string;
  status: string;
  issuedOn: string;
  dueOn: string;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  customerId: string;
  customerName: string;
  daysOverdue: number;
  bucket: AgeingBucket;
}

const FINAL = new Set(["paid", "written_off", "cancelled"]);

/** Every invoice of the tenant with its derived balance (RLS limits rows to the user's tenants). */
export async function listInvoices(ctx: TenantContext): Promise<InvoiceListItem[]> {
  const [invoices, balances] = await Promise.all([
    ctx.supabase
      .from("invoices")
      .select("id, number, status, issued_on, due_on, amount_total, currency, customer_id, customers(display_name)")
      .eq("tenant_id", ctx.tenant.id)
      .order("due_on", { ascending: true }),
    ctx.supabase.from("invoice_balances").select("invoice_id, amount_paid, balance").eq("tenant_id", ctx.tenant.id),
  ]);
  if (invoices.error) throw new Error(invoices.error.message);
  if (balances.error) throw new Error(balances.error.message);
  const byId = new Map((balances.data ?? []).map((b) => [b.invoice_id, b]));
  return (invoices.data ?? []).map((i) => {
    const b = byId.get(i.id);
    const days = FINAL.has(i.status) ? 0 : daysOverdue(i.due_on, ctx.tenant.timezone);
    const balance = b?.balance ?? i.amount_total;
    return {
      id: i.id,
      number: i.number,
      status: i.status,
      issuedOn: i.issued_on,
      dueOn: i.due_on,
      currency: i.currency,
      total: i.amount_total,
      paid: b?.amount_paid ?? 0,
      balance,
      customerId: i.customer_id,
      customerName: i.customers?.display_name ?? "",
      daysOverdue: days,
      bucket: FINAL.has(i.status) || balance <= 0 ? "not_due" : ageingBucket(days),
    };
  });
}

export const isOutstanding = (i: InvoiceListItem) => !FINAL.has(i.status) && i.balance > 0;
