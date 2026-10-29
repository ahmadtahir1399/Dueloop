// Data lifecycle CLIs (prompt 7 step 3, ADR 0051). Service-role / trusted connection only; never logs contact
// details or message text (counts and ids only).
//   pnpm retention:run [--now <iso>]                    purge per policy; proof files of long-closed invoices
//   pnpm customer export --tenant <id> --customer <id> [--out file.json]   everything held about one customer
//   pnpm customer erase  --tenant <id> --customer <id> --yes [--user <who>] anonymise + redact; ledger kept
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { localEnv } from '../../../db/scripts/local-env.ts';
import { supabaseProofStore } from '../../../proofs/src/store.ts';

/** Retention defaults (ADR 0051). Raw provider payloads already carry purge_after (prompts 4/5). */
export const RETENTION = {
  importRowsDays: 90,
  closedLinksDays: 30,
  rateLimitDays: 2,
  /** Proof files of invoices that are final (paid/written off/cancelled) for longer than this are deleted. */
  proofFileDaysAfterClose: 400,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { tenant: { type: 'string' }, customer: { type: 'string' }, out: { type: 'string' }, yes: { type: 'boolean', default: false }, user: { type: 'string', default: 'cli' }, now: { type: 'string' } },
});
const [area, cmd] = positionals;
const pool = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL ?? localEnv().dbUrl, max: 2, application_name: 'dueloop-data' });
const now = values.now ? new Date(values.now) : new Date();
const out = (o: unknown) => process.stdout.write(`${JSON.stringify(o)}\n`);

function store() {
  const local = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? null : localEnv();
  return supabaseProofStore(process.env.SUPABASE_URL ?? local?.apiUrl ?? '', process.env.SUPABASE_SERVICE_ROLE_KEY ?? local?.serviceRoleKey ?? '');
}

async function exportCustomer(tenant: string, customer: string) {
  const q = async (sql: string) => (await pool.query(sql, [tenant, customer])).rows;
  const data = {
    exported_at: now.toISOString(),
    customer: await q('select id, display_name, email, phone_e164, language, preferred_channel, opted_out, external_id, created_at from public.customers where tenant_id = $1 and id = $2'),
    consents: await q('select channel, granted_at, source, revoked_at from public.customer_consents where tenant_id = $1 and customer_id = $2'),
    invoices: await q(`select i.number, i.status, i.issued_on, i.due_on, i.currency, i.amount_total::text, b.balance::text from public.invoices i
                       join public.invoice_balances b on b.invoice_id = i.id where i.tenant_id = $1 and i.customer_id = $2`),
    messages: await q('select direction, channel, purpose, subject, body, send_state, sent_at, received_at, created_at from public.messages where tenant_id = $1 and customer_id = $2 order by created_at'),
    promises: await q('select promised_on, status, created_at, resolved_at from public.promises where tenant_id = $1 and customer_id = $2'),
    receipts: await q('select amount::text, currency, method, source, received_at from public.receipts where tenant_id = $1 and customer_id = $2'),
    credits: await q('select amount::text, currency, created_at from public.credits where tenant_id = $1 and customer_id = $2'),
    proofs: await q('select id, status, mime, size_bytes, original_name, created_at from public.payment_proofs where tenant_id = $1 and customer_id = $2'),
    tasks: await q('select type, status, created_at, resolved_at from public.tasks where tenant_id = $1 and customer_id = $2'),
    events: await q(`select e.type, e.created_at from public.invoice_events e join public.invoices i on i.id = e.invoice_id where e.tenant_id = $1 and i.customer_id = $2 order by e.created_at`),
  };
  if (data.customer.length === 0) throw new Error('customer not found');
  return data;
}

try {
  if (area === 'retention' && cmd === 'run') {
    const r = await pool.query<{ r: Record<string, number> }>('select private.retention_run($1, $2, $3, $4) as r', [now, RETENTION.importRowsDays, RETENTION.closedLinksDays, RETENTION.rateLimitDays]);
    const files = await pool.query<{ storage_path: string; id: string }>(
      `select p.storage_path, p.id from public.payment_proofs p join public.invoices i on i.tenant_id = p.tenant_id and i.id = p.invoice_id
       where p.status <> 'pending' and i.status in ('paid', 'written_off', 'cancelled') and i.updated_at < $1::timestamptz - make_interval(days => $2::int)
         and p.hints <> '{"purged": true}'::jsonb`,
      [now, RETENTION.proofFileDaysAfterClose],
    );
    if (files.rows.length) {
      await store().remove?.(files.rows.map((f) => f.storage_path));
      await pool.query(`update public.payment_proofs set hints = '{"purged": true}'::jsonb, original_name = null where id = any($1)`, [files.rows.map((f) => f.id)]);
    }
    out({ result: 'retention_done', ...(r.rows[0]?.r ?? {}), proof_files: files.rows.length });
  } else if (area === 'customer' && (cmd === 'export' || cmd === 'erase')) {
    const tenant = values.tenant ?? '';
    const customer = values.customer ?? '';
    if (!UUID.test(tenant) || !UUID.test(customer)) throw new Error('--tenant and --customer must be ids');
    const exists = await pool.query('select 1 from public.customers where tenant_id = $1 and id = $2', [tenant, customer]);
    if (exists.rowCount !== 1) throw new Error('customer not found in this tenant');
    if (cmd === 'export') {
      const data = await exportCustomer(tenant, customer);
      const counts = Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'exported_at').map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
      await pool.query('select private.log_customer_export($1, $2, $3, $4, $5)', [tenant, customer, values.user, JSON.stringify(counts), now]);
      if (values.out) {
        writeFileSync(values.out, JSON.stringify(data, null, 2));
        out({ result: 'exported', file: values.out, counts });
      } else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    } else {
      if (!values.yes) throw new Error('erasure is permanent: re-run with --yes');
      const proofs = await pool.query<{ storage_path: string }>('select storage_path from public.payment_proofs where tenant_id = $1 and customer_id = $2', [tenant, customer]);
      const r = await pool.query<{ r: Record<string, number> }>('select private.erase_customer($1, $2, $3, $4) as r', [tenant, customer, values.user, now]);
      if (proofs.rows.length) await store().remove?.(proofs.rows.map((p) => p.storage_path));
      out({ result: 'erased', ...(r.rows[0]?.r ?? {}), proof_files_deleted: proofs.rows.length });
    }
  } else {
    console.error('usage: retention run [--now] | customer export|erase --tenant <id> --customer <id> [--yes] [--out file]');
    process.exitCode = 2;
  }
} catch (e) {
  const m = e instanceof Error ? e.message : 'failed';
  console.error(m.replace(/postgres(ql)?:\/\/\S+/g, '[db-url]'));
  process.exitCode = 1;
} finally {
  await pool.end();
}
