// CSV export of the customer list (RLS applies). Contact details are included because every member may already
// read them on screen (ADR 0042 export.lists); no secrets exist on these rows.
import { can } from "@dueloop/authz";
import { csvResponse, EXPORT_MAX_ROWS } from "@/lib/csv";
import { allCustomers, parseCustomerFilters } from "@/lib/data/customers";
import { requireTenant } from "@/lib/session";

export async function GET(req: Request) {
  const ctx = await requireTenant();
  if (!can(ctx.role, "export.lists")) return new Response("Not found", { status: 404 });
  const f = parseCustomerFilters(Object.fromEntries(new URL(req.url).searchParams));
  async function* rows() {
    for await (const c of allCustomers(ctx, f, EXPORT_MAX_ROWS)) {
      yield [c.display_name, c.email, c.phone_e164, c.language, c.preferred_channel, c.opted_out ? "yes" : "no"];
    }
  }
  return csvResponse("customers.csv", ["name", "email", "phone", "language", "preferred_channel", "opted_out"], rows(), async (count) => {
    await ctx.supabase.rpc("log_list_export", { p_tenant: ctx.tenant.id, p_list: "customers", p_rows: count });
  });
}
