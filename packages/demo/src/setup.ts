// Demo data on top of the seed (supabase/seed.sql, separate from migrations): a FakeGateway TEST account for the demo
// tenant and three sign-in logins with fresh random passwords (shown once, never written to disk). Local only.
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { demoPassword } from './safety.ts';
import { fail, TENANT, URLS } from './runtime.ts';

export const DEMO_USERS = [
  { email: 'demo.owner@demo-agency.test', role: 'owner' },
  { email: 'demo.accountant@demo-agency.test', role: 'accountant' },
  { email: 'demo.collector@demo-agency.test', role: 'collector' },
] as const;

export interface SetupResult {
  tenantId: string;
  payment: { token: string; secret: string };
  logins: { email: string; role: string; password: string }[];
}

export async function setupDemoData(env: NodeJS.ProcessEnv): Promise<SetupResult> {
  const pool = new pg.Pool({ connectionString: env.WORKER_DATABASE_URL, max: 2 });
  try {
    const tenantId = (await pool.query<{ id: string }>('select id from public.tenants where name = $1', [TENANT])).rows[0]?.id ?? fail(`the seed has no tenant "${TENANT}"`);
    // FakeGateway test account: random webhook token (only its hash is stored) and signing secret, per run.
    const token = randomBytes(32).toString('base64url');
    const secret = randomBytes(24).toString('base64url');
    const acc = (
      await pool.query<{ id: string }>(`insert into public.payment_accounts (tenant_id, provider, mode, webhook_token_hash) values ($1, 'fake', 'test', $2) returning id`, [tenantId, createHash('sha256').update(token).digest('hex')])
    ).rows[0]?.id;
    await pool.query(`select private.set_payment_secret($1, 'webhook_secret', $2)`, [acc, secret]);
    await pool.query(`select private.set_payment_secret($1, 'api_key', 'fake_test_key_demo')`, [acc]);

    const admin = createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
    const logins: SetupResult['logins'] = [];
    for (const u of DEMO_USERS) {
      const password = demoPassword();
      // Created through the Auth admin API after every reset (the seed's own staff rows have no password and are not
      // Auth-managed users, so they cannot sign in by design).
      const res = await admin.auth.admin.createUser({ email: u.email, password, email_confirm: true });
      if (res.error || !res.data.user) fail(`could not set up the demo login ${u.email}: ${res.error?.message ?? 'no user'}`);
      await pool.query('insert into public.memberships (tenant_id, user_id, role) values ($1, $2, $3) on conflict do nothing', [tenantId, res.data.user?.id, u.role]);
      logins.push({ email: u.email, role: u.role, password });
    }
    await fetch(`${URLS.mailpit}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
    return { tenantId, payment: { token, secret }, logins };
  } finally {
    await pool.end();
  }
}
