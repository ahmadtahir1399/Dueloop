import "server-only";
import type { TenantContext } from "@/lib/session";

// Invoice list with keyset pagination on (due_on, id) (issue R). Filters are validated here; nothing from the
// URL reaches PostgREST unchecked. Money is selected as text (issue I).

export const PAGE_SIZE = 50;
export const STATUSES = ["open", "overdue", "promised", "disputed", "escalated", "paid", "written_off", "cancelled"] as const;
export const LIST_BUCKETS = ["not_due", "1-30", "31-60", "61-90", "91+", "closed"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface InvoiceFilters {
  status?: (typeof STATUSES)[number];
  bucket?: (typeof LIST_BUCKETS)[number];
  customer?: string;
  q?: string;
  after?: { due: string; id: string };
}

export function parseFilters(sp: Record<string, string | string[] | undefined>): InvoiceFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const f: InvoiceFilters = {};
  const status = one("status");
  if (status && (STATUSES as readonly string[]).includes(status)) f.status = status as InvoiceFilters["status"];
  const bucket = one("bucket");
  if (bucket && (LIST_BUCKETS as readonly string[]).includes(bucket)) f.bucket = bucket as InvoiceFilters["bucket"];
  const customer = one("customer");
  if (customer && UUID.test(customer)) f.customer = customer;
  const q = cleanSearch(one("q"));
  if (q) f.q = q;
  const after = one("after");
  const m = after ? /^(\d{4}-\d{2}-\d{2})_([0-9a-f-]{36})$/.exec(after) : null;
  if (m && m[1] && m[2] && DATE.test(m[1]) && UUID.test(m[2])) f.after = { due: m[1], id: m[2] };
  return f;
}

/** Search text: letters, digits, space and - . / # only (no LIKE wildcards), 60 chars. */
export function cleanSearch(q: string | undefined): string | undefined {
  if (!q) return undefined;
  const s = q.normalize("NFKC").replace(/[^\p{L}\p{N} \-./#]/gu, "").trim().slice(0, 60);
  return s.length > 0 ? s : undefined;
}

export interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  issued_on: string;
  due_on: string;
  currency: string;
  amount_total: string;
  amount_paid: string;
  balance: string;
  customer_id: string;
  customer_name: string;
  days_past_due: number;
  bucket: string;
  promised_on: string | null;
}

const COLUMNS =
  "id, number, status, issued_on, due_on, currency, amount_total::text, amount_paid::text, balance::text, customer_id, customer_name, days_past_due, bucket, promised_on";

export async function listInvoicePage(ctx: TenantContext, f: InvoiceFilters, limit = PAGE_SIZE): Promise<{ rows: InvoiceRow[]; next: string | null }> {
  let query = ctx.supabase.from("invoice_list").select(COLUMNS).eq("tenant_id", ctx.tenant.id);
  if (f.status) query = query.eq("status", f.status);
  if (f.bucket) query = query.eq("bucket", f.bucket);
  if (f.customer) query = query.eq("customer_id", f.customer);
  if (f.q) query = query.ilike("search", `%${f.q.toLowerCase()}%`);
  if (f.after) query = query.or(`due_on.gt.${f.after.due},and(due_on.eq.${f.after.due},id.gt.${f.after.id})`);
  const { data, error } = await query.order("due_on").order("id").limit(limit + 1);
  if (error) throw new Error("could not load invoices");
  const rows = (data ?? []) as unknown as InvoiceRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { rows: page, next: rows.length > limit && last ? `${last.due_on}_${last.id}` : null };
}

/** Every row for a CSV export, streamed page by page through the same keyset. */
export async function* allInvoices(ctx: TenantContext, f: Omit<InvoiceFilters, "after">, cap: number): AsyncGenerator<InvoiceRow> {
  let after: InvoiceFilters["after"];
  let n = 0;
  for (;;) {
    const page = await listInvoicePage(ctx, { ...f, ...(after ? { after } : {}) }, 1000);
    for (const r of page.rows) {
      if (n++ >= cap) return;
      yield r;
    }
    if (!page.next) return;
    const last = page.rows[page.rows.length - 1];
    if (!last) return;
    after = { due: last.due_on, id: last.id };
  }
}

export async function loadInvoice(ctx: TenantContext, id: string) {
  if (!UUID.test(id)) return null;
  const sb = ctx.supabase;
  const t = ctx.tenant.id;
  const inv = await sb
    .from("invoice_list")
    .select(`${COLUMNS}, next_action_at`)
    .eq("tenant_id", t)
    .eq("id", id)
    .maybeSingle();
  if (inv.error) throw new Error("could not load invoice");
  if (!inv.data) return null;
  const [refs, events, promises, receipts, payments, credits, tasks, links] = await Promise.all([
    sb.from("invoices").select("reference_code, parked_reason").eq("tenant_id", t).eq("id", id).single(),
    sb.from("invoice_events").select("id, type, payload, created_at").eq("tenant_id", t).eq("invoice_id", id).order("created_at").order("id").limit(500),
    sb.from("promises").select("id, promised_on, status, created_at, resolved_at, resolution_note").eq("tenant_id", t).eq("invoice_id", id).order("created_at", { ascending: false }),
    sb.from("receipts").select("id, amount::text, currency, method, source, received_at, provider_ref").eq("tenant_id", t).eq("invoice_id", id).order("received_at"),
    sb.from("payments").select("id, amount::text, currency, paid_at, source").eq("tenant_id", t).eq("invoice_id", id).order("paid_at"),
    sb.from("credits").select("id, amount::text, currency, created_at").eq("tenant_id", t).eq("invoice_id", id).order("created_at"),
    sb.from("tasks").select("id, type, status, urgent, created_at, blocks_reminders_until").eq("tenant_id", t).eq("invoice_id", id).order("created_at", { ascending: false }),
    sb.from("message_invoices").select("message_id").eq("tenant_id", t).eq("invoice_id", id),
  ]);
  for (const r of [refs, events, promises, receipts, payments, credits, tasks, links]) if (r.error) throw new Error("could not load invoice details");
  const ids = (links.data ?? []).map((l) => l.message_id);
  const messages = ids.length
    ? await sb
        .from("messages")
        .select("id, direction, channel, subject, body, send_state, sent_at, received_at, created_at, purpose, analysis")
        .eq("tenant_id", t)
        .in("id", ids.slice(0, 200))
        .order("created_at")
    : { data: [], error: null };
  if (messages.error) throw new Error("could not load messages");
  return {
    invoice: { ...(inv.data as unknown as InvoiceRow & { next_action_at: string }), reference_code: refs.data?.reference_code ?? "", parked_reason: refs.data?.parked_reason ?? null },
    events: events.data ?? [],
    promises: promises.data ?? [],
    receipts: receipts.data ?? [],
    payments: payments.data ?? [],
    credits: credits.data ?? [],
    tasks: tasks.data ?? [],
    messages: messages.data ?? [],
  };
}
