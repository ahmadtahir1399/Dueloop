// pnpm chaos: crash at every protocol step, a real SIGKILL mid-batch, and the kill switch mid-batch.
// Invariant: one idempotency key => at most ONE adapter call, in every case.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FailpointName } from '../src/ports.ts';
import { crashAt, expireVisibility, messagesOf, pool, q, quietCron, world } from './harness.ts';

beforeAll(quietCron);
afterAll(() => pool.end());

const cases: { point: FailpointName; calls: number; state: string }[] = [
  { point: 'after_claim', calls: 1, state: 'sent' },
  { point: 'after_pending_insert', calls: 0, state: 'unknown' },
  { point: 'after_adapter', calls: 1, state: 'unknown' },
  { point: 'after_record', calls: 1, state: 'sent' },
];

describe('kill points (deterministic failpoints)', () => {
  it.each(cases)('crash $point -> adapter calls $calls, ends $state', async ({ point, calls, state }) => {
    const w = await world();
    await expect(w.run({ failpoints: crashAt(point) })).rejects.toThrow(/failpoint/);
    // "Restart": the job reappears after its visibility timeout and is processed again, more than once.
    for (let i = 0; i < 2; i++) {
      await expireVisibility(w.tenantId);
      await w.run();
    }
    w.clock.advanceMinutes(20); // past the stale-pending threshold
    await w.sweep();
    await expireVisibility(w.tenantId);
    await w.run();
    const [m] = await messagesOf(w.tenantId);
    const key = `${w.invoiceIds[0]}:s1:email`;
    expect(w.email.keys().filter((k) => k === key)).toHaveLength(calls);
    expect(m?.send_state).toBe(state);
    if (state === 'unknown') {
      // Never silent: an alert, an event, and the invoice is parked for a human.
      expect(w.notifier.alerts.filter((a) => a.kind === 'message_unknown')).toHaveLength(1);
      expect((await q<{ type: string }>(`select type from public.invoice_events where tenant_id = $1 and type = 'MessageStateUnknown'`, [w.tenantId]))).toHaveLength(1);
    }
  });
});

describe('SIGKILL mid-batch', () => {
  it('100 jobs: kill the runner, restart it, no duplicate key, no lost job, no stuck job', { timeout: 180_000 }, async () => {
    const w = await world({ count: 100, separateCustomers: true });
    const dir = mkdtempSync(path.join(tmpdir(), 'dueloop-chaos-'));
    const sendLog = path.join(dir, 'sends.log');
    const runner = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'sigkill-runner.ts');
    const env = { ...process.env, TENANT_ID: w.tenantId, NOW_ISO: w.clock.now().toISOString(), SEND_LOG: sendLog };
    const lines = () => (existsSync(sendLog) ? readFileSync(sendLog, 'utf8').split('\n').filter(Boolean) : []);

    let stderr = '';
    const start = () => {
      const child = spawn(process.execPath, [runner], { env, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      const exited = new Promise<number | null>((r) => child.once('exit', (c) => r(c)));
      return { child, exited };
    };

    const first = start();
    let firstExited = false;
    void first.exited.then(() => (firstExited = true));
    while (lines().length < 25 && !firstExited) await new Promise((r) => setTimeout(r, 20));
    expect(firstExited, stderr).toBe(false); // it must still be mid-batch when we kill it
    first.child.kill('SIGKILL');
    await first.exited;
    const atKill = lines().length;

    const second = start();
    expect(await second.exited, stderr).toBe(0);

    // Anything left pending by the killed process becomes unknown at the stale sweep (never resent).
    w.clock.advanceMinutes(20);
    await w.sweep();
    await expireVisibility(w.tenantId);
    await w.run({ channels: { get: () => undefined } }); // drain leftover jobs; no channel may be called here

    const sends = lines();
    const byKey = new Map<string, number>();
    for (const k of sends) byKey.set(k, (byKey.get(k) ?? 0) + 1);
    const duplicates = [...byKey.values()].filter((n) => n > 1).length;
    const states = await q<{ s: string; n: number }>(
      `select coalesce(m.send_state, 'none') as s, count(*)::int as n from public.invoices i
       left join public.message_invoices mi on mi.invoice_id = i.id
       left join public.messages m on m.id = mi.message_id
       where i.tenant_id = $1 group by 1 order by 1`,
      [w.tenantId],
    );
    const queued = await q(`select 1 from pgmq.q_followup_actions where message ->> 'tenant_id' = $1`, [w.tenantId]);
    const pending = states.find((s) => s.s === 'pending')?.n ?? 0;
    const accounted = states.filter((s) => s.s === 'sent' || s.s === 'unknown').reduce((a, s) => a + s.n, 0);
    console.log(JSON.stringify({ sendsAtKill: atKill, totalSends: sends.length, uniqueKeys: byKey.size, duplicates, states, queued: queued.length }));

    expect(duplicates).toBe(0); // no duplicate key ever reached the adapter twice
    expect(accounted).toBe(100); // no lost job: every invoice ended sent or unknown
    expect(pending).toBe(0); // no stuck job
    expect(queued).toHaveLength(0);
    expect(sends.length).toBe(byKey.size);
  });
});

describe('kill switch mid-batch (issue F, rule 18)', () => {
  it('flip the global switch after 3 sends: zero sends after the flip; released jobs run after resuming', async () => {
    const w = await world({ count: 10, separateCustomers: true });
    w.email.onSend = async () => {
      if (w.email.calls.length === 3) await q(`update private.system_flags set enabled = true where key = 'outbound_paused'`);
    };
    try {
      const r = await w.run();
      expect(w.email.calls).toHaveLength(3);
      expect(r.outcomes).toMatchObject({ sent: 3, released: 7 });
    } finally {
      await q(`update private.system_flags set enabled = false where key = 'outbound_paused'`);
    }
    w.email.onSend = null;
    await expireVisibility(w.tenantId);
    await w.run();
    expect(w.email.calls).toHaveLength(10);
    expect(new Set(w.email.keys()).size).toBe(10);
  });

  it('tenant switch flipped mid-batch behaves the same', async () => {
    const w = await world({ count: 4, separateCustomers: true });
    w.email.onSend = async () => {
      if (w.email.calls.length === 1) await q('update public.tenants set outbound_paused = true where id = $1', [w.tenantId]);
    };
    await w.run();
    expect(w.email.calls).toHaveLength(1);
  });
});

describe('notifier de-duplication', () => {
  it('same cause + same invoice => one alert; another invoice => its own alert', async () => {
    const w = await world({ templates: false, count: 2, separateCustomers: true });
    await w.run();
    for (const id of w.invoiceIds) await q('select private.unpark_invoice($1, $2)', [id, w.clock.now()]);
    await w.run();
    expect(w.notifier.alerts.filter((a) => a.kind === 'parked')).toHaveLength(2);
  });

  it('a throwing notifier never fails the job', async () => {
    const w = await world({ templates: false });
    const r = await w.run({ notifier: { notify: async () => { throw new Error('slack down'); } } });
    expect(r.outcomes).toEqual({ parked: 1 });
  });
});
