// pnpm perf:seed --invoices 50000 [--measure-only]
// LOCAL stack only. Creates "Perf Co" (tenant 9e7f0000-...-0a) with N invoices, N/5 customers, payments on a third,
// tasks and inbound messages, and an owner user (perf-owner@e2e.test) for the page timing run. Then measures the
// dashboard's list and KPI queries with EXPLAIN (ANALYZE, BUFFERS) AS THAT USER (RLS on), 5 runs each, median.
// Prints a table; numbers are from this machine only.
import { parseArgs } from 'node:util';
import pg from 'pg';
import { localEnv } from './local-env.ts';

const { values } = parseArgs({ options: { invoices: { type: 'string', default: '50000' }, 'measure-only': { type: 'boolean', default: false } } });
const N = Number(values.invoices);
if (!Number.isSafeInteger(N) || N < 100 || N > 500_000) {
  console.error('--invoices must be 100..500000');
  process.exit(2);
}
const env = localEnv();
if (!/@(127\.0\.0\.1|localhost):/.test(env.dbUrl)) {
  console.error('perf:seed refuses a non-local database');
  process.exit(2);
}
const T = '9e7f0000-0000-4000-8000-00000000000a';
const OWNER = '9e7f0000-0000-4000-8000-0000000000a1';
const pool = new pg.Pool({ connectionString: env.dbUrl, max: 2 });

async function seed() {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select private.purge_tenant($1)`, [T]).catch(() => undefined);
    await c.query('commit');
    await c.query('begin');
    await c.query(`insert into auth.users (id, email) values ($1, 'perf-owner@e2e.test') on conflict (id) do nothing`, [OWNER]);
    await c.query(`insert into public.tenants (id, name, timezone, currency) values ($1, 'Perf Co', 'Asia/Karachi', 'PKR')`, [T]);
    await c.query(`insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [T, OWNER]);
    await c.query(
      `insert into public.customers (tenant_id, display_name, email)
       select $1, 'Perf Customer ' || g, 'perf' || g || '@example.test' from generate_series(1, $2) g`,
      [T, Math.ceil(N / 5)],
    );
    await c.query(
      `with cs as (select id, row_number() over (order by id) as rn from public.customers where tenant_id = $1)
       insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code, status)
       select $1, cs.id, 'PF-' || lpad(g::text, 7, '0'), 1000 + (g * 7919) % 900000, 'PKR',
              current_date - 30 - (g % 200), current_date - (g % 200) + 60,
              upper(substr(md5(g::text), 1, 8)), 'open'
       from generate_series(1, $2) g join cs on cs.rn = 1 + (g % (select count(*) from cs))`,
      [T, N],
    );
    // New invoices start open (guard_invoice_write); past-due ones move to overdue through the state machine.
    await c.query(`update public.invoices set status = 'overdue' where tenant_id = $1 and due_on < current_date`, [T]);
    await c.query(
      // The ledger shape the real pipeline writes: one receipt, fully applied as one payment (received = applied).
      `with r as (
         insert into public.receipts (tenant_id, invoice_id, customer_id, method, source, provider_ref, amount, currency, received_at)
         select tenant_id, id, customer_id, 'bank_transfer', 'manual', 'PERF-' || id, amount_total / 3, currency, now() - interval '3 days'
         from public.invoices where tenant_id = $1 and (hashtext(id::text) % 3) = 0
         returning id, tenant_id, invoice_id, amount, currency, provider_ref, received_at)
       insert into public.payments (tenant_id, invoice_id, receipt_id, amount, currency, method, provider_ref, paid_at, source)
       select tenant_id, invoice_id, id, amount, currency, 'bank_transfer', provider_ref, received_at, 'manual' from r`,
      [T],
    );
    await c.query(
      `insert into public.tasks (tenant_id, type, status, invoice_id, dedupe_key, created_at)
       select tenant_id, 'human_review', 'open', id, 'perf-' || id, now() from public.invoices where tenant_id = $1 and (hashtext(id::text) % 50) = 0`,
      [T],
    );
    await c.query('commit');
    await c.query('analyze');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

const QUERIES: [string, string][] = [
  ['invoice list, first page', `select id, number, due_on, balance from public.invoice_list where tenant_id = '${T}' order by due_on, id limit 51`],
  ['invoice list, page 50 (keyset)', `select id, number, due_on, balance from public.invoice_list where tenant_id = '${T}' and (due_on > current_date - 100 or (due_on = current_date - 100 and id > '00000000-0000-0000-0000-000000000000')) order by due_on, id limit 51`],
  ['invoice list, status=overdue', `select id, number from public.invoice_list where tenant_id = '${T}' and status = 'overdue' order by due_on, id limit 51`],
  ['invoice list, bucket=31-60', `select id, number from public.invoice_list where tenant_id = '${T}' and bucket = '31-60' order by due_on, id limit 51`],
  ['invoice list, search', `select id, number from public.invoice_list where tenant_id = '${T}' and search ilike '%pf-00123%' order by due_on, id limit 51`],
  ['customer list, first page', `select id, display_name from public.customers where tenant_id = '${T}' order by display_name, id limit 51`],
  ['kpi_ageing (overview)', `select * from public.kpi_ageing(now()) where tenant_id = '${T}'`],
  ['nav_counters', `select * from public.nav_counters('${T}')`],
];

async function measure() {
  const c = await pool.connect();
  const rows: { query: string; median_ms: number; rows: number; plan: string }[] = [];
  try {
    for (const [name, sql] of QUERIES) {
      const times: number[] = [];
      let plan = '';
      let n = 0;
      for (let i = 0; i < 5; i++) {
        await c.query('begin');
        await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: OWNER, role: 'authenticated' }), OWNER]);
        await c.query('set local role authenticated');
        const r = await c.query<{ 'QUERY PLAN': { 'Execution Time': number; Plan: { 'Actual Rows': number; 'Node Type': string } }[] }>(`explain (analyze, buffers, format json) ${sql}`);
        await c.query('rollback');
        const p = r.rows[0]?.['QUERY PLAN'][0];
        times.push(p?.['Execution Time'] ?? NaN);
        n = p?.Plan['Actual Rows'] ?? 0;
        plan = JSON.stringify(p?.Plan).match(/"Index Name":"[^"]+"/g)?.slice(0, 3).join(' ') ?? (p?.Plan['Node Type'] ?? '');
      }
      times.sort((a, b) => a - b);
      rows.push({ query: name, median_ms: Math.round((times[2] ?? NaN) * 100) / 100, rows: n, plan });
    }
  } finally {
    c.release();
  }
  return rows;
}

try {
  if (!values['measure-only']) {
    const t0 = Date.now();
    await seed();
    console.log(`seeded ${N} invoices for Perf Co in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  const counts = (await pool.query(`select (select count(*) from public.invoices where tenant_id = $1)::int as invoices, (select count(*) from public.customers where tenant_id = $1)::int as customers`, [T])).rows[0];
  console.log(JSON.stringify(counts));
  console.table(await measure());
} finally {
  await pool.end();
}
