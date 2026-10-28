// Test helpers for public links: issue real links through @dueloop/links (the worker's function) and take a
// snapshot of every table a public GET could possibly write to.
import { hashToken, issueLinks } from "@dueloop/links";
import { db } from "./db";
import { BASE_URL } from "./stack";
import { DEMO_TENANT } from "./users";

export async function issueFor(invoiceNumber: string): Promise<{ payToken: string; optToken: string; invoiceId: string; customerId: string }> {
  const r = await db().query<{ id: string; customer_id: string }>("select id, customer_id from public.invoices where tenant_id = $1 and number = $2", [DEMO_TENANT, invoiceNumber]);
  const inv = r.rows[0];
  if (!inv) throw new Error(`no invoice ${invoiceNumber}`);
  const l = await issueLinks(db(), { tenantId: DEMO_TENANT, invoiceId: inv.id, customerId: inv.customer_id, now: new Date(), baseUrl: BASE_URL });
  const tok = (u: string | null) => (u ?? "").split("/").pop() ?? "";
  return { payToken: tok(l.payUrl), optToken: tok(l.optOutUrl), invoiceId: inv.id, customerId: inv.customer_id };
}

/** Everything a public GET might touch. Equal snapshots before/after = zero writes. */
export async function writeSnapshot(): Promise<Record<string, string>> {
  const r = await db().query(
    `select
       (select count(*) || ':' || coalesce(sum(uses), 0) || ':' || coalesce(max(last_used_at)::text, '') from public.public_links) as links,
       (select count(*)::text from public.messages) as messages,
       (select count(*)::text from public.tasks) as tasks,
       (select count(*)::text from public.promises) as promises,
       (select count(*)::text from public.payment_requests) as requests,
       (select count(*)::text from public.invoice_events) as invoice_events,
       (select count(*)::text from public.tenant_events) as tenant_events,
       (select count(*) || ':' || coalesce(sum(hits), 0) from private.rate_limits) as rate_limits,
       (select count(*)::text from auth.sessions) as sessions,
       (select string_agg(status, ',' order by id) from public.invoices where tenant_id = $1) as statuses,
       (select string_agg(opted_out::text, ',' order by id) from public.customers where tenant_id = $1) as opt_outs`,
    [DEMO_TENANT],
  );
  return r.rows[0] as Record<string, string>;
}

export async function revoke(token: string) {
  await db().query("update public.public_links set revoked_at = now() where token_hash = $1", [hashToken(token)]);
}
export async function expire(token: string) {
  await db().query("update public.public_links set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where token_hash = $1", [hashToken(token)]);
}

/** open -> overdue (a legal transition; the 0002 trigger checks it), for tests that need an overdue invoice. */
export async function makeOverdue(invoiceId: string) {
  await db().query("update public.invoices set status = 'overdue' where id = $1 and status = 'open'", [invoiceId]);
}
