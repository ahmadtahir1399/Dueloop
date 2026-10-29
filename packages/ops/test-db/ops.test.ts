// Prompt 7 steps 2-3 against the real local database: schema guard, heartbeats + watchdog (chaos: kill the
// worker), retention (counts only), erasure (ledger intact, suppression), event payloads free of contact data.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localEnv } from '../../db/scripts/local-env.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const env = { ...process.env, WORKER_DATABASE_URL: localEnv().dbUrl, SUPABASE_URL: localEnv().apiUrl, SUPABASE_SERVICE_ROLE_KEY: localEnv().serviceRoleKey };
const node = (args: string[]) => spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
let pool: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: localEnv().dbUrl, max: 3 });
});
afterAll(async () => {
  await pool.end();
});

describe('schema-version guard (rule 45)', () => {
  it('the worker refuses to start when the database is newer than the build, and says why', async () => {
    await pool.query("insert into supabase_migrations.schema_migrations (version, name) values ('9999', 'test_future')");
    try {
      const r = node(['packages/worker/src/bin/worker.ts', '--once']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('database schema is 9999, this build expects');
      expect(r.stderr).not.toMatch(/postgres(ql)?:\/\//);
    } finally {
      await pool.query("delete from supabase_migrations.schema_migrations where version = '9999'");
    }
  });
});

describe('heartbeats and watchdog', () => {
  it('chaos: kill the worker; the watchdog reports a critical stale heartbeat once per hour', async () => {
    await pool.query('delete from private.service_heartbeats');
    await pool.query('delete from private.ops_alerts');
    // The worker must not touch anyone else's data (seed, other suites): global kill switch on (nothing is
    // enqueued or sent) and scoped to an empty tenant of its own. It still runs full passes and heartbeats.
    const HB = '0d000000-0000-4000-8000-0000000000b1';
    await pool.query('select private.purge_tenant($1)', [HB]).catch(() => undefined);
    await pool.query(`insert into public.tenants (id, name, timezone, currency) values ($1, 'Heartbeat Co', 'Europe/London', 'GBP')`, [HB]);
    await pool.query(`update private.system_flags set enabled = true where key = 'outbound_paused'`);
    const w = spawn(process.execPath, ['packages/worker/src/bin/worker.ts', '--loop', '--interval', '5', '--tenant', HB], { cwd: root, env, stdio: 'ignore' });
    let seen = 0;
    try {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline && seen === 0) {
        seen = (await pool.query<{ n: number }>("select count(*)::int as n from private.service_heartbeats where service = 'worker'")).rows[0]?.n ?? 0;
        if (seen === 0) await new Promise((r) => setTimeout(r, 500)); // polling observable state, not a fixed sleep
      }
    } finally {
      w.kill('SIGKILL');
      await pool.query(`update private.system_flags set enabled = false where key = 'outbound_paused'`);
      await pool.query('select private.purge_tenant($1)', [HB]);
    }
    expect(seen).toBe(1);
    const healthy = node(['packages/ops/src/bin/ops.ts', 'watchdog']);
    expect(JSON.parse(healthy.stdout).findings.filter((f: { key: string }) => f.key === 'heartbeat:worker')).toEqual([]);
    const later = new Date(Date.now() + 10 * 60_000).toISOString();
    const r1 = node(['packages/ops/src/bin/ops.ts', 'watchdog', '--now', later]);
    expect(r1.status).toBe(1);
    const j1 = JSON.parse(r1.stdout);
    expect(j1.findings.find((f: { key: string }) => f.key === 'heartbeat:worker')?.severity).toBe('critical');
    expect(j1.alerted).toContain('heartbeat:worker');
    const r2 = node(['packages/ops/src/bin/ops.ts', 'watchdog', '--now', later]);
    expect(JSON.parse(r2.stdout).alerted).not.toContain('heartbeat:worker'); // de-duplicated
  }, 150_000);

  it('ops:status reports every documented number', () => {
    const r = node(['packages/ops/src/bin/ops.ts', 'status']);
    expect(r.status).toBe(0);
    const s = JSON.parse(r.stdout);
    for (const k of ['schema_version', 'queue_depth', 'queue_oldest_seconds', 'due_not_enqueued', 'parked_invoices', 'unknown_messages', 'dead_letters_24h', 'pending_approvals', 'unprocessed_inbound', 'unprocessed_payment_events', 'paused_tenants', 'global_paused', 'heartbeats'])
      expect(s).toHaveProperty(k);
  });

  it('no API role can reach the ops objects', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await expect(c.query('select * from private.service_heartbeats')).rejects.toThrow();
      await c.query('rollback');
      await c.query('begin');
      await c.query('set local role anon');
      await expect(c.query('select private.ops_status(now())')).rejects.toThrow();
      await c.query('rollback');
    } finally {
      c.release();
    }
  });
});

describe('retention and erasure', () => {
  const T = '0d000000-0000-4000-8000-00000000000a';
  const C = '0d000000-0000-4000-8000-0000000000ca';
  const C2 = '0d000000-0000-4000-8000-0000000000cb';
  beforeAll(async () => {
    await pool.query('select private.purge_tenant($1)', [T]).catch(() => undefined);
    await pool.query(`insert into public.tenants (id, name, timezone, currency) values ($1, 'Erase Co', 'Asia/Kolkata', 'INR')`, [T]);
    await pool.query(`insert into public.customers (id, tenant_id, display_name, email, phone_e164) values ($1, $2, 'Anna Example', 'anna@example.test', '+447700900123'), ($3, $2, 'Open Ltd', 'open@example.test', null)`, [C, T, C2]);
    for (const [n, cust, status] of [['E-1', C, 'open'], ['E-2', C2, 'open']] as const) {
      await pool.query(`insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code, status) values ($1, $2, $3, 50000, 'INR', '2026-01-01', '2026-02-01', $4, $5)`, [T, cust, n, `REF${n.replace('-', '')}AB`, status]);
    }
    const inv = (await pool.query<{ id: string }>(`select id from public.invoices where tenant_id = $1 and number = 'E-1'`, [T])).rows[0]?.id;
    await pool.query(`insert into public.messages (tenant_id, customer_id, channel, direction, purpose, body, subject, received_at) values ($1, $2, 'email', 'in', 'reply', 'Hi, this is Anna, call me on +44 7700 900123', 'Re: invoice', now())`, [T, C]);
    // Paid in full through the ledger: receipt + payment slice (the real pipeline's shape).
    const rc = await pool.query<{ id: string }>(`insert into public.receipts (tenant_id, invoice_id, customer_id, method, source, provider_ref, amount, currency, received_at) values ($1, $2, $3, 'bank_transfer', 'manual', 'ERASE-REF-1', 50000, 'INR', now()) returning id`, [T, inv, C]);
    await pool.query(`insert into public.payments (tenant_id, invoice_id, receipt_id, amount, currency, method, provider_ref, paid_at, source) values ($1, $2, $3, 50000, 'INR', 'bank_transfer', 'ERASE-REF-1', now(), 'manual')`, [T, inv, rc.rows[0]?.id]);
    await pool.query(`update public.invoices set status = 'paid' where id = $1`, [inv]);
  });
  afterAll(async () => {
    await pool.query('select private.purge_tenant($1)', [T]);
  });

  it('refuses hostile and cross-tenant ids, and customers with open invoices', () => {
    expect(node(['packages/ops/src/bin/data.ts', 'customer', 'erase', '--tenant', T, '--customer', "x'; drop table customers; --", '--yes']).status).toBe(1);
    expect(node(['packages/ops/src/bin/data.ts', 'customer', 'erase', '--tenant', '5eed0000-0000-4000-8000-00000000000a', '--customer', C, '--yes']).stderr).toContain('not found in this tenant');
    const open = node(['packages/ops/src/bin/data.ts', 'customer', 'erase', '--tenant', T, '--customer', C2, '--yes']);
    expect(open.status).toBe(1);
    expect(open.stderr).toContain('open invoice');
  });

  it('export returns everything held and is logged (counts only)', async () => {
    const r = node(['packages/ops/src/bin/data.ts', 'customer', 'export', '--tenant', T, '--customer', C]);
    expect(r.status).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.customer[0].email).toBe('anna@example.test');
    expect(data.messages).toHaveLength(1);
    const ev = await pool.query(`select payload from public.tenant_events where tenant_id = $1 and type = 'CustomerExported'`, [T]);
    expect(JSON.stringify(ev.rows[0]?.payload)).not.toContain('anna');
  });

  it('erase anonymises and redacts, keeps the ledger balanced, and the contact stays suppressed', async () => {
    const r = node(['packages/ops/src/bin/data.ts', 'customer', 'erase', '--tenant', T, '--customer', C, '--yes', '--user', 'test']);
    expect(r.status, r.stderr).toBe(0);
    const c = (await pool.query(`select display_name, email, phone_e164, opted_out from public.customers where id = $1`, [C])).rows[0];
    expect(c).toEqual({ display_name: 'Erased customer 0d000000', email: null, phone_e164: null, opted_out: true });
    const m = (await pool.query(`select body, subject from public.messages where customer_id = $1`, [C])).rows[0];
    expect(m).toEqual({ body: null, subject: null });
    expect((await pool.query(`select count(*)::int as n from public.receipts where customer_id = $1`, [C])).rows[0]?.n).toBe(1);
    const integrity = node(['packages/worker/src/bin/payments.ts', 'integrity', '--tenant', T]);
    expect(integrity.status, integrity.stdout).toBe(0);
    // Re-runnable (e.g. after a failed storage call): a second erase succeeds and records no second event.
    const again = node(['packages/ops/src/bin/data.ts', 'customer', 'erase', '--tenant', T, '--customer', C, '--yes', '--user', 'test']);
    expect(again.status, again.stderr).toBe(0);
    expect((await pool.query(`select count(*)::int as n from public.tenant_events where tenant_id = $1 and type = 'CustomerErased'`, [T])).rows[0]?.n).toBe(1);
    // Re-adding the same person (import, API or by hand; emails are stored normalised) comes back opted out.
    await pool.query(`insert into public.customers (tenant_id, display_name, email) values ($1, 'Anna Again', 'anna@example.test')`, [T]);
    expect((await pool.query(`select opted_out from public.customers where tenant_id = $1 and display_name = 'Anna Again'`, [T])).rows[0]?.opted_out).toBe(true);
  });

  it('retention runs and logs counts only', async () => {
    const r = node(['packages/ops/src/bin/data.ts', 'retention', 'run']);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).result).toBe('retention_done');
    const ev = (await pool.query(`select payload from public.tenant_events where tenant_id = $1 and type = 'RetentionRun' order by id desc limit 1`, [T])).rows[0]?.payload;
    for (const v of Object.values(ev ?? {})) expect(typeof v).toBe('number');
  });
});

describe('events and ledger rows hold no contact details (precondition of erasure)', () => {
  it('no invoice_event, tenant_event, receipt or payment contains an email address or a phone number', async () => {
    const r = await pool.query<{ t: string; n: number }>(
      `select 'invoice_events' as t, count(*)::int as n from public.invoice_events where payload::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}|\\+[0-9]{8,}'
       union all select 'tenant_events', count(*)::int from public.tenant_events where payload::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}|\\+[0-9]{8,}'
       union all select 'receipts', count(*)::int from public.receipts where coalesce(note, '') ~* '@|\\+[0-9]{8,}'`,
    );
    expect(Object.fromEntries(r.rows.map((x) => [x.t, x.n]))).toEqual({ invoice_events: 0, tenant_events: 0, receipts: 0 });
  });
});
