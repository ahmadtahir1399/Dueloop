// Public link actions (ADR 0045, issues C and E), all POST, all through EXISTING pipelines:
// - promise / copy request / opt-out: a structured Proposal (no model) planned by core planReplyOutcome with the same
//   rules the inbound processor uses, applied by InboundDb.applyPlan in one transaction. The pay-page action is
//   recorded as an inbound message on the 'web' channel (matched_by 'pay_page_token'), so it shows in the inbox and
//   the timeline like any reply. A valid token counts like a thread match: it proves possession of our message
//   (a forwarded link carries the same power; ADR 0045).
// - pay: prompt 5 createRequestFor (one active request per invoice + provider; reuse valid, replace on change).
// - proof upload: prompt 5 processProofJob with the uploaded bytes as the media source (same checks and caps).
import "server-only";
import { createHash } from "node:crypto";
import { DEFAULT_REPLY_RULES, planReplyOutcome, type Effect, type InvoiceStatus, type Proposal } from "@dueloop/core";
import { InboundDb } from "@dueloop/inbound";
import { markUsed, resolveLink, type ResolvedLink } from "@dueloop/links";
import { safePayLink } from "@dueloop/messaging";
import { createRequestFor } from "@dueloop/payments";
import { processProofJob, sanitiseFileName, type MediaFetcher } from "@dueloop/proofs";
import { WorkerDb } from "@dueloop/worker";
import { buildDeps, buildPaymentsDeps, buildProofsDeps } from "@dueloop/worker/runtime";
import { DateTime } from "luxon";
import { trustedPool } from "@/lib/trusted/db";
import { opsEnv } from "@/lib/trusted/ops";

const clock = { now: () => new Date() };
const OPEN: readonly string[] = ["open", "overdue", "promised", "escalated"];

export type ActionResult = "ok" | "review" | "invalid" | "closed" | "gateway_down" | "refused" | "failed";

export async function resolve(token: string, purpose: "pay" | "opt_out"): Promise<ResolvedLink | null> {
  return resolveLink(trustedPool(), token, purpose, new Date());
}

/** Inserts (or finds) the inbound 'web' message that carries this action. Returns null when it was processed already. */
async function webMessage(link: ResolvedLink, key: string, body: string, attachments: unknown[] = []): Promise<{ id: string; fresh: boolean }> {
  const pool = trustedPool();
  const ins = await pool.query<{ id: string }>(
    `insert into public.messages (tenant_id, customer_id, channel, direction, purpose, body, received_at, idempotency_key, matched_by, prefilter, attachments)
     values ($1, $2, 'web', 'in', 'reply', $3, now(), $4, 'pay_page_token', 'pay_page', $5)
     on conflict (tenant_id, idempotency_key) do nothing returning id`,
    [link.tenantId, link.customerId, body, key, JSON.stringify(attachments)],
  );
  if (ins.rows[0]) {
    if (link.invoiceId) await pool.query("insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3) on conflict do nothing", [link.tenantId, ins.rows[0].id, link.invoiceId]);
    return { id: ins.rows[0].id, fresh: true };
  }
  const old = await pool.query<{ id: string }>("select id from public.messages where tenant_id = $1 and idempotency_key = $2", [link.tenantId, key]);
  return { id: old.rows[0]?.id ?? "", fresh: false };
}

async function plan(link: ResolvedLink, proposal: Proposal, messageId: string, now: Date): Promise<"applied" | "review" | "closed"> {
  const db = new InboundDb(trustedPool());
  const tenant = await db.tenant(link.tenantId);
  const inv = link.invoiceId ? await db.invoice(link.tenantId, link.invoiceId) : null;
  if (link.invoiceId && (!inv || !OPEN.includes(inv.status))) return "closed";
  for (let round = 0; round < 3; round++) {
    const fresh = link.invoiceId ? await db.invoice(link.tenantId, link.invoiceId) : null;
    const effects: readonly Effect[] = planReplyOutcome({
      proposal,
      invoice: fresh ? { status: fresh.status, balanceMinor: fresh.balanceMinor, currency: fresh.currency } : null,
      reference: now,
      timezone: tenant.timezone,
      senderTrusted: true,
      statedAmount: { kind: "none" },
      activePromise: fresh ? await db.activePromise(link.tenantId, fresh.id) : null,
      renewalCount: fresh ? await db.renewalCount(link.tenantId, fresh.id) : 0,
      rules: { ...DEFAULT_REPLY_RULES, promiseAcceptance: tenant.promiseAcceptance },
    }).effects;
    const r = await db.applyPlan({
      tenantId: link.tenantId,
      messageId,
      customerId: link.customerId,
      invoiceId: link.invoiceId,
      expectedStatus: (fresh?.status ?? null) as InvoiceStatus | null,
      reference: now,
      now,
      effects,
      extraTasks: [],
      tenantEvents: [],
      linkInvoiceIds: link.invoiceId ? [link.invoiceId] : [],
      drafts: {},
      messageFields: { matchedBy: "pay_page_token", prefilter: "pay_page", analysis: { source: "pay_page", intent: proposal.intent }, modelId: null, promptVersion: null, latencyMs: null, tokensIn: null, tokensOut: null },
    });
    if (r.kind === "status_changed") continue;
    if (r.kind === "applied") await notify(link, r.notify);
    return effects.some((e) => e.kind === "create_task") ? "review" : "applied";
  }
  return "review";
}

async function notify(link: ResolvedLink, effects: readonly Effect[]) {
  const n = buildDeps(opsEnv(), new WorkerDb(trustedPool()), clock).notifier;
  for (const e of effects) {
    if (e.kind !== "notify") continue;
    try {
      await n.notify({ tenantId: link.tenantId, dedupeKey: `paypage:${link.linkId}:${e.topic}:${new Date().toISOString().slice(0, 10)}`, kind: e.topic, severity: "info", title: `Customer action on the pay page: ${e.topic.replaceAll("_", " ")}`, lines: [] });
    } catch {
      // an alert failure never undoes the recorded action
    }
  }
}

function localDay(tz: string, now: Date) {
  return DateTime.fromJSDate(now, { zone: tz }).toISODate() ?? "";
}

/** "Tell us when you'll pay": promise_to_pay with the typed date; validatePromiseDate runs inside the plan (rule 26). */
export async function promiseFromPage(link: ResolvedLink, date: string): Promise<ActionResult> {
  if (!link.invoiceId) return "invalid";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "review";
  const now = new Date();
  const tz = (await new InboundDb(trustedPool()).tenant(link.tenantId)).timezone;
  const msg = await webMessage(link, `paypage:${link.invoiceId}:promise:${date}:${localDay(tz, now)}`, `Promised payment date entered on the pay page: ${date}`);
  if (!msg.fresh) return "ok";
  await markUsed(trustedPool(), link.linkId, now);
  const r = await plan(link, { intent: "promise_to_pay", confidence: 1, promisedDate: date, dateIsVague: false, statedAmountText: null }, msg.id, now);
  return r === "closed" ? "closed" : r === "review" ? "review" : "ok";
}

/** "Request a copy": an info_request task, at most once per invoice per local day. No PDF is generated. */
export async function copyRequest(link: ResolvedLink): Promise<ActionResult> {
  if (!link.invoiceId) return "invalid";
  const now = new Date();
  const tz = (await new InboundDb(trustedPool()).tenant(link.tenantId)).timezone;
  const msg = await webMessage(link, `paypage:${link.invoiceId}:copy:${localDay(tz, now)}`, "Invoice copy requested on the pay page.");
  if (!msg.fresh) return "ok";
  await markUsed(trustedPool(), link.linkId, now);
  const r = await plan(link, { intent: "needs_info", confidence: 1, promisedDate: null, dateIsVague: false, statedAmountText: null }, msg.id, now);
  return r === "closed" ? "closed" : "ok";
}

/** Opt-out through the same record_opt_out effect as a STOP reply (prompt 4). */
export async function optOut(link: ResolvedLink): Promise<ActionResult> {
  const now = new Date();
  const msg = await webMessage(link, `optout:${link.linkId}`, "Opt-out requested on the opt-out page.");
  if (!msg.fresh) return "ok";
  await markUsed(trustedPool(), link.linkId, now);
  await plan(link, { intent: "opt_out", confidence: 1, promisedDate: null, dateIsVague: false, statedAmountText: null }, msg.id, now);
  return "ok";
}

/** "Pay now": the provider checkout is created HERE (on POST), never during a GET render (issue C). */
export async function payNow(link: ResolvedLink): Promise<{ result: ActionResult; url?: string }> {
  if (!link.invoiceId) return { result: "invalid" };
  const st = await trustedPool().query<{ status: string }>("select status from public.invoices where tenant_id = $1 and id = $2", [link.tenantId, link.invoiceId]);
  if (!OPEN.includes(st.rows[0]?.status ?? "")) return { result: "closed" };
  try {
    const deps = buildPaymentsDeps(opsEnv(), new WorkerDb(trustedPool()), clock);
    const r = await createRequestFor(deps, link.tenantId, link.invoiceId);
    const url = safePayLink(r.request?.url ?? null);
    if (!url) return { result: "gateway_down" };
    await markUsed(trustedPool(), link.linkId, new Date());
    return { result: "ok", url };
  } catch {
    return { result: "gateway_down" };
  }
}

/** Proof upload: one file, the prompt 5 checks (magic bytes, size, per-customer daily cap, storage cap). */
export async function uploadProof(link: ResolvedLink, file: { name: string; type: string; bytes: Uint8Array }): Promise<ActionResult> {
  if (!link.invoiceId) return "invalid";
  const now = new Date();
  const digest = createHash("sha256").update(file.bytes).digest("hex").slice(0, 16);
  const name = sanitiseFileName(file.name) ?? "upload";
  const msg = await webMessage(link, `paypage:${link.invoiceId}:proof:${digest}`, "Proof of payment uploaded on the pay page.", [{ filename: name, mime: file.type || "application/octet-stream", size: file.bytes.length }]);
  if (!msg.fresh) return "ok";
  await markUsed(trustedPool(), link.linkId, now);
  const media: MediaFetcher = { fetch: async () => ({ ok: true, bytes: Buffer.from(file.bytes) }) };
  const deps = { ...buildProofsDeps(opsEnv(), new WorkerDb(trustedPool()), clock), media };
  // msgId 0: there is no queue row for a direct upload; acking it is a no-op.
  const out = await processProofJob({ msgId: 0, readCount: 1, tenantId: link.tenantId, messageId: msg.id }, deps);
  if (out === "missing") return "failed";
  await trustedPool().query("update public.messages set processed_at = coalesce(processed_at, now()) where id = $1", [msg.id]);
  return out.stored > 0 ? "ok" : out.limited > 0 ? "refused" : out.rejected > 0 ? "refused" : "ok";
}
