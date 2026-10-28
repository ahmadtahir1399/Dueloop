// Issue M: the last owner of a tenant can never be removed or demoted, even by two concurrent transactions that
// each demote a DIFFERENT owner (each alone would be fine; together they would leave zero owners).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localEnv } from '../../db/scripts/local-env.ts';

const T = '0e000000-0000-4000-8000-0000000000a1';
const U1 = '0e000000-0000-4000-8000-0000000000b1';
const U2 = '0e000000-0000-4000-8000-0000000000b2';

async function client() {
  const c = new pg.Client({ connectionString: localEnv().dbUrl });
  await c.connect();
  return c;
}

describe('last owner, concurrently', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = await client();
    await admin.query(`select private.purge_tenant($1)`, [T]).catch(() => undefined);
    await admin.query(`delete from auth.users where id in ($1, $2)`, [U1, U2]);
    await admin.query(`insert into auth.users (id, email) values ($1, 'lo1@test.invalid'), ($2, 'lo2@test.invalid')`, [U1, U2]);
    await admin.query(`insert into public.tenants (id, name, timezone, currency) values ($1, 'Last Owner Co', 'Europe/Berlin', 'EUR')`, [T]);
  });
  afterAll(async () => {
    await admin.query(`select private.purge_tenant($1)`, [T]);
    await admin.query(`delete from auth.users where id in ($1, $2)`, [U1, U2]);
    await admin.end();
  });

  for (const op of ['demote', 'remove'] as const) {
    it(`two concurrent ${op}s of the two owners leave exactly one owner`, async () => {
      await admin.query(`delete from public.memberships where tenant_id = $1 and role <> 'owner'`, [T]);
      await admin.query(
        `insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'owner')
         on conflict (tenant_id, user_id) do update set role = 'owner'`,
        [T, U1, U2],
      );
      const a = await client();
      const b = await client();
      try {
        await a.query('begin');
        await b.query('begin');
        const sql = op === 'demote'
          ? `update public.memberships set role = 'accountant' where tenant_id = $1 and user_id = $2`
          : `delete from public.memberships where tenant_id = $1 and user_id = $2`;
        // A takes the tenant lock first; B blocks on it until A commits, then sees only one owner left.
        await a.query(sql, [T, U1]);
        const bResult = b.query(sql, [T, U2]).then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');
        await a.query('commit');
        const outcome = await bResult;
        await b.query(outcome === 'ok' ? 'commit' : 'rollback');
        expect(outcome).toBe('23514');
      } finally {
        await a.end();
        await b.end();
      }
      const owners = await admin.query(`select count(*)::int as n from public.memberships where tenant_id = $1 and role = 'owner'`, [T]);
      expect(owners.rows[0].n).toBe(1);
    });
  }
});
