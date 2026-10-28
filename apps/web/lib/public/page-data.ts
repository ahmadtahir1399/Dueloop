// Read-only data for the public pages (GET). Nothing here writes: no view counter, no session, no provider call
// (rule 35, issue B). Unknown tokens still do one lookup so a malformed and a well-formed unknown token take
// similar time.
import "server-only";
import { hashToken, looksLikeToken, resolveLink, type ResolvedLink } from "@dueloop/links";
import { trustedPool } from "@/lib/trusted/db";

const DUMMY = "A".repeat(43);

export interface PayPage {
  link: ResolvedLink;
  business: string;
  timezone: string;
  bankInstructions: string | null;
  invoiceNumber: string;
  referenceCode: string;
  dueOn: string;
  status: string;
  currency: string;
  amountTotal: string;
  amountPaid: string;
  balance: string;
  hasGateway: boolean;
}

export async function linkFor(token: string, purpose: "pay" | "opt_out"): Promise<ResolvedLink | null> {
  const ok = looksLikeToken(token);
  const link = await resolveLink(trustedPool(), ok ? token : DUMMY, purpose, new Date());
  return ok ? link : null;
}

export async function payPage(token: string): Promise<PayPage | null> {
  const link = await linkFor(token, "pay");
  if (!link) return null;
  const r = await trustedPool().query<{ d: Record<string, unknown> | null }>("select private.pay_page($1) as d", [link.linkId]);
  const d = r.rows[0]?.d;
  if (!d) return null;
  return {
    link,
    business: String(d.business),
    timezone: String(d.timezone),
    bankInstructions: typeof d.bank_instructions === "string" ? d.bank_instructions : null,
    invoiceNumber: String(d.invoice_number),
    referenceCode: String(d.reference_code),
    dueOn: String(d.due_on),
    status: String(d.status),
    currency: String(d.currency),
    amountTotal: String(d.amount_total),
    amountPaid: String(d.amount_paid),
    balance: String(d.balance),
    hasGateway: d.has_gateway === true,
  };
}

export async function optOutPage(token: string): Promise<{ link: ResolvedLink; business: string } | null> {
  const link = await linkFor(token, "opt_out");
  if (!link) return null;
  const r = await trustedPool().query<{ name: string }>("select name from public.tenants where id = $1", [link.tenantId]);
  return r.rows[0] ? { link, business: r.rows[0].name } : null;
}

export { hashToken };
