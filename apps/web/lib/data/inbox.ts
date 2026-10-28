import "server-only";
import type { TenantContext } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CHANNELS = ["email", "whatsapp", "sms"] as const;
export const THREAD_PAGE = 50;

export async function listThreads(ctx: TenantContext, before: string | undefined) {
  let q = ctx.supabase
    .from("inbox_threads")
    .select("customer_id, channel, customer_name, last_at, messages, unprocessed")
    .eq("tenant_id", ctx.tenant.id);
  if (before && !Number.isNaN(Date.parse(before))) q = q.lt("last_at", new Date(before).toISOString());
  const { data, error } = await q.order("last_at", { ascending: false }).limit(THREAD_PAGE + 1);
  if (error) throw new Error("could not load the inbox");
  const rows = data ?? [];
  const page = rows.slice(0, THREAD_PAGE);
  const last = page[page.length - 1];
  return { rows: page, next: rows.length > THREAD_PAGE && last?.last_at ? last.last_at : null };
}

export interface Attachment {
  name: string;
  mime: string;
  size: number | null;
}

/** Attachment METADATA only, from the stored JSON. Names are untrusted text; nothing is fetched or opened here. */
export function attachmentsOf(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const o = a as Record<string, unknown>;
    const name = typeof o.filename === "string" ? o.filename : typeof o.name === "string" ? o.name : "attachment";
    const mime = typeof o.mime === "string" ? o.mime : typeof o.contentType === "string" ? o.contentType : "unknown";
    const size = typeof o.size === "number" && Number.isSafeInteger(o.size) ? o.size : null;
    return [{ name: name.slice(0, 200), mime: mime.slice(0, 100), size }];
  });
}

export async function loadThread(ctx: TenantContext, customerId: string, channel: string) {
  if (!UUID.test(customerId) || !(CHANNELS as readonly string[]).includes(channel)) return null;
  const sb = ctx.supabase;
  const t = ctx.tenant.id;
  const customer = await sb.from("customers").select("id, display_name").eq("tenant_id", t).eq("id", customerId).maybeSingle();
  if (customer.error) throw new Error("could not load the customer");
  if (!customer.data) return null;
  const msgs = await sb
    .from("messages")
    .select("id, direction, subject, body, attachments, analysis, matched_by, send_state, sent_at, received_at, created_at")
    .eq("tenant_id", t)
    .eq("customer_id", customerId)
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(100);
  if (msgs.error) throw new Error("could not load messages");
  const ids = (msgs.data ?? []).map((m) => m.id);
  const links = ids.length
    ? await sb.from("message_invoices").select("message_id, invoice_id, invoices(number)").eq("tenant_id", t).in("message_id", ids)
    : { data: [], error: null };
  if (links.error) throw new Error("could not load matched invoices");
  const byMessage = new Map<string, { id: string; number: string }[]>();
  for (const l of links.data ?? []) {
    const list = byMessage.get(l.message_id) ?? [];
    list.push({ id: l.invoice_id, number: l.invoices?.number ?? "" });
    byMessage.set(l.message_id, list);
  }
  return {
    customer: customer.data,
    messages: (msgs.data ?? []).reverse().map((m) => ({ ...m, invoices: byMessage.get(m.id) ?? [], files: attachmentsOf(m.attachments) })),
  };
}
