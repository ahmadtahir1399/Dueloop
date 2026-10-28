import "server-only";
import type { TenantContext } from "@/lib/session";
import { cleanSearch } from "@/lib/data/invoices";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CUSTOMER_PAGE = 50;

export interface CustomerFilters {
  q?: string;
  optedOut?: boolean;
  after?: { name: string; id: string };
}

export function parseCustomerFilters(sp: Record<string, string | string[] | undefined>): CustomerFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const f: CustomerFilters = {};
  const q = cleanSearch(one("q"));
  if (q) f.q = q;
  if (one("opted_out") === "1") f.optedOut = true;
  const after = one("after");
  if (after) {
    const i = after.lastIndexOf("_");
    const name = after.slice(0, i);
    const id = after.slice(i + 1);
    if (i > 0 && UUID.test(id) && name.length <= 300) f.after = { name, id };
  }
  return f;
}

/** A value placed inside a PostgREST logical filter: double-quoted, with backslashes and quotes escaped. */
function quoted(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function listCustomerPage(ctx: TenantContext, f: CustomerFilters, limit = CUSTOMER_PAGE) {
  let q = ctx.supabase
    .from("customers")
    .select("id, display_name, email, phone_e164, language, preferred_channel, opted_out")
    .eq("tenant_id", ctx.tenant.id);
  if (f.q) q = q.ilike("display_name", `%${f.q}%`);
  if (f.optedOut) q = q.eq("opted_out", true);
  if (f.after) {
    const v = quoted(f.after.name);
    q = q.or(`display_name.gt.${v},and(display_name.eq.${v},id.gt.${f.after.id})`);
  }
  const { data, error } = await q.order("display_name").order("id").limit(limit + 1);
  if (error) throw new Error("could not load customers");
  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, next: rows.length > limit && last ? `${last.display_name}_${last.id}` : null };
}

/** Every customer for a CSV export, through the same keyset. */
export async function* allCustomers(ctx: TenantContext, f: CustomerFilters, cap: number) {
  let after: CustomerFilters["after"];
  let n = 0;
  for (;;) {
    const page = await listCustomerPage(ctx, { ...f, after }, 1000);
    for (const r of page.rows) {
      if (n++ >= cap) return;
      yield r;
    }
    const last = page.rows[page.rows.length - 1];
    if (!page.next || !last) return;
    after = { name: last.display_name, id: last.id };
  }
}

export async function loadCustomer(ctx: TenantContext, id: string) {
  if (!UUID.test(id)) return null;
  const sb = ctx.supabase;
  const t = ctx.tenant.id;
  const c = await sb
    .from("customers")
    .select("id, display_name, email, phone_e164, language, preferred_channel, opted_out, external_id, created_at")
    .eq("tenant_id", t)
    .eq("id", id)
    .maybeSingle();
  if (c.error) throw new Error("could not load customer");
  if (!c.data) return null;
  const [consents, invoices] = await Promise.all([
    sb.from("customer_consents").select("id, channel, granted_at, source, revoked_at").eq("tenant_id", t).eq("customer_id", id).order("granted_at"),
    sb.from("invoice_list").select("id, number, status, due_on, currency, balance::text").eq("tenant_id", t).eq("customer_id", id).order("due_on").limit(200),
  ]);
  if (consents.error || invoices.error) throw new Error("could not load customer details");
  return { customer: c.data, consents: consents.data ?? [], invoices: invoices.data ?? [] };
}
