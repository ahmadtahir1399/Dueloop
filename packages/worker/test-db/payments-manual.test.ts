// Prompt 5 step 5: manual recording rules (role, amount text, date tolerance, currency, bank-ref uniqueness)
// and the `pnpm payments` CLI, including payments:integrity failing on a corrupted ledger row.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { planManualPayment, recordManualPayment } from '@dueloop/payments';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, q, quietCron } from './harness.ts';
import { balanceOf, payWorld, receiptsOf } from './payments-harness.ts';

beforeAll(quietCron);
afterAll(() => pool.end());

async function member(tenantId: string, role: string): Promise<string> {
  const id = randomUUID();
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}-${id.slice(0, 8)}@test-co.example`]);
  await q(`insert into public.memberships (tenant_id, user_id, role) values ($1, $2, $3)`, [tenantId, id, role]);
  return id;
}

describe('planManualPayment', () => {
  it('refuses a collector, bad amounts, future dates, the wrong currency and a reused bank ref', async () => {
    const w = await payWorld({ count: 2 });
    const base = { tenantId: w.tenantId, invoice: 'T-1', amount: '100.00', date: '2026-06-09', bankRef: 'BR-1', user: w.ownerId };
    const refusal = async (o: Partial<typeof base>) => {
      const p = await planManualPayment(w.pdeps(), { ...base, ...o });
      return p.ok ? 'ok' : p.refusal;
    };
    const collector = await member(w.tenantId, 'collector');
    expect(await refusal({ user: collector })).toMatch(/collector cannot confirm/);
    expect(await refusal({ user: randomUUID() })).toBe('unknown user for this tenant');
    expect(await refusal({ amount: '0' })).toMatch(/positive/);
    expect(await refusal({ amount: '-5' })).toMatch(/positive/);
    expect(await refusal({ amount: '1.005' })).toMatch(/decimal place/);
    expect(await refusal({ amount: '99999999999999999' })).toMatch(/too large/);
    expect(await refusal({ amount: '100 EUR' })).toBe('wrong currency: the invoice is in GBP');
    expect(await refusal({ date: '2026-06-12' })).toMatch(/future/); // today is 10 June in London; +1 day allowed
    expect(await refusal({ date: '2026-06-11' })).toBe('ok');
    expect(await refusal({ date: '10/06/2026' })).toBe('date must be YYYY-MM-DD');
    expect(await refusal({ date: '2026-02-30' })).toMatch(/no such/);
    expect(await refusal({ bankRef: '  ' })).toMatch(/bank reference is required/);
    expect(await refusal({ invoice: 'NOPE' })).toBe('invoice not found');

    const accountant = await member(w.tenantId, 'accountant');
    const ok = await planManualPayment(w.pdeps(), { ...base, user: accountant, amount: '£1,000.50' });
    if (!ok.ok) throw new Error(ok.refusal);
    expect(ok.amountMinor).toBe(100050);
    expect(ok.plan).toMatchObject({ applied: 100050, credit: 0, transition: null });
    expect(await recordManualPayment(w.pdeps(), ok, null)).toMatchObject({ outcome: 'applied' });
    expect(await balanceOf(w.invoiceIds[0] ?? '')).toBe(25000);
    expect(await refusal({})).toBe('this bank reference is already recorded for this invoice');
    expect(await refusal({ invoice: 'T-2' })).toBe('this bank reference is already recorded for another invoice');
  });
});

const last = (out: string) => JSON.parse(out.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>; // logs come first
const run = (args: string[]) => spawnSync(process.execPath, ['packages/worker/src/bin/payments.ts', ...args], { encoding: 'utf8', env: { ...process.env } });

describe('pnpm payments CLI', () => {
  it('record prints the plan without --yes and writes nothing; with --yes records once', async () => {
    const w = await payWorld();
    const args = ['record', '--tenant', w.tenantId, '--invoice', 'T-1', '--amount', '250.50', '--date', '2026-06-10', '--bank-ref', 'CLI-REF-1', '--user', w.ownerId, '--now', '2026-06-10T09:00:00Z'];
    const dry = run(args);
    expect(dry.status).toBe(0);
    expect(last(dry.stdout)).toMatchObject({ result: 'plan', plan: { amount: 25050, applied: 25050, credit: 0 } });
    expect(await receiptsOf(w.tenantId)).toEqual([]);
    const yes = run([...args, '--yes']);
    expect(yes.status).toBe(0);
    expect(last(yes.stdout)).toMatchObject({ result: 'recorded' });
    const again = run([...args, '--yes']);
    expect(again.status).toBe(1);
    expect(last(again.stdout)).toEqual({ result: 'refused', reason: 'this bank reference is already recorded for this invoice' });
    expect(await receiptsOf(w.tenantId)).toHaveLength(1);
    // Nothing sensitive in the output: no bank ref echo, no customer data.
    expect(yes.stdout).not.toContain('CLI-REF-1');
    expect(yes.stdout).not.toContain('ada@customer.example');
  });

  it('payments:integrity exits 0 when clean and 1 on a corrupted row', async () => {
    const w = await payWorld();
    await w.manual(0, 1000, 'INT-1');
    const clean = run(['integrity', '--tenant', w.tenantId]);
    expect(clean.status).toBe(0);
    expect(clean.stdout.trim().split('\n').at(-1)).toBe('{"result":"clean","count":0}');

    const c = await pool.connect();
    try {
      // Corrupt one receipt (an extra credit) with triggers off, run the real CLI, then remove the corruption.
      await c.query('set session_replication_role = replica');
      await c.query(`insert into public.credits (tenant_id, receipt_id, customer_id, invoice_id, amount, currency) select tenant_id, id, customer_id, invoice_id, 7, currency from public.receipts where tenant_id = $1`, [w.tenantId]);
      const bad = run(['integrity', '--tenant', w.tenantId]);
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain('"finding":"receipt_unbalanced"');
      await c.query(`delete from public.credits where tenant_id = $1 and amount = 7`, [w.tenantId]);
    } finally {
      await c.query('set session_replication_role = origin');
      c.release();
    }
    expect(run(['integrity', '--tenant', w.tenantId]).status).toBe(0);
  });

  it('usage errors exit 2', () => {
    expect(run(['record']).status).toBe(2);
    expect(execFileSync(process.execPath, ['-e', 'process.exit(0)']).toString()).toBe('');
  });
});
