// pnpm db:rls-check must FAIL when a public table has no RLS. Proven with a throwaway table that is
// created and dropped within this test (the session also ran it against a throwaway migration).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { query } from './db.ts';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/rls-check.ts');
const run = () => spawnSync(process.execPath, [script], { encoding: 'utf8' });

describe('rls-check', () => {
  afterAll(async () => {
    await query('drop table if exists public.zz_rls_check_throwaway');
  });

  it('passes on the real schema', () => {
    const r = run();
    expect(r.stdout + r.stderr).toContain('RLS check passed');
    expect(r.status).toBe(0);
  });

  it('fails, naming the table, when a public table lacks RLS', async () => {
    await query('create table public.zz_rls_check_throwaway (id int)');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('public.zz_rls_check_throwaway: table without row level security');
    await query('drop table public.zz_rls_check_throwaway');
    expect(run().status).toBe(0);
  });
});
