// CSV export of the invoice list with the same filters as the screen (RLS applies: the user's client).
import { can } from "@dueloop/authz";
import { csvResponse, EXPORT_MAX_ROWS } from "@/lib/csv";
import { allInvoices, parseFilters } from "@/lib/data/invoices";
import { requireTenant } from "@/lib/session";

export async function GET(req: Request) {
  const ctx = await requireTenant();
  if (!can(ctx.role, "export.lists")) return new Response("Not found", { status: 404 });
  const f = parseFilters(Object.fromEntries(new URL(req.url).searchParams));
  async function* rows() {
    for await (const r of allInvoices(ctx, f, EXPORT_MAX_ROWS)) {
      yield [r.number, r.customer_name, r.status, r.issued_on, r.due_on, r.currency, r.amount_total, r.amount_paid, r.balance, r.bucket];
    }
  }
  return csvResponse(
    "invoices.csv",
    ["invoice_number", "customer", "status", "issued_on", "due_on", "currency", "amount_total_minor", "amount_paid_minor", "balance_minor", "age"],
    rows(),
    async (count) => {
      await ctx.supabase.rpc("log_list_export", { p_tenant: ctx.tenant.id, p_list: "invoices", p_rows: count });
    },
  );
}
