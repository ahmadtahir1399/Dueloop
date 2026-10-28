// pnpm test:load — 5,000 overdue invoices, fake adapter, fake clock, the REAL token-bucket limiter and the
// real local database. Not in CI (slow); run it locally before changing the queue, claim or limiter code.
import { TokenBucketLimiter, type RateLimit } from '@dueloop/messaging';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { processBatch } from '../src/process.ts';
import { expireVisibility, pool, q, quietCron, world } from '../test-db/harness.ts';

const N = 5000;
const LIMIT: RateLimit = { capacity: 50, refillPerSecond: 50 };

beforeAll(quietCron);
afterAll(() => pool.end());

it(`${N} invoices: every key sent exactly once, the limiter is never exceeded, nothing left behind`, { timeout: 20 * 60_000 }, async () => {
  const w = await world({ count: 1 });
  // 4,999 more invoices, each with its own customer, in bulk (the weekly cap is per customer).
  await q(
    `with c as (
       insert into public.customers (id, tenant_id, display_name, email)
       select gen_random_uuid(), $1, 'Load ' || g, 'load' || g || '@customer.example' from generate_series(2, $2::int) g
       returning id, display_name)
     insert into public.invoices (tenant_id, customer_id, number, amount_total, currency, issued_on, due_on, reference_code, next_action_at)
     select $1, c.id, 'L-' || substr(c.display_name, 6), 125050, 'GBP', '2026-05-01', '2026-06-01',
            'REF' || upper(substr(md5(c.id::text), 1, 9)), '2000-01-01'
     from c`,
    [w.tenantId, N],
  );

  const sendTimes: number[] = [];
  w.email.onSend = () => void sendTimes.push(w.clock.now().getTime());
  const limiter = new TokenBucketLimiter(() => LIMIT, () => w.clock.now().getTime());
  const deps = w.deps({ limiter });

  const started = Date.now();
  await deps.db.enqueue(N + 100, w.clock.now());
  let rounds = 0;
  for (;;) {
    rounds++;
    const r = await processBatch(deps, { limit: 80, filter: { tenant_id: w.tenantId } });
    if (r.claimed === 0) break;
    // Rate-limited jobs were released with a real visibility delay; fast-forward both clocks by one second.
    w.clock.advanceMinutes(1 / 60);
    await expireVisibility(w.tenantId);
    if (rounds > 2000) throw new Error('no progress');
  }
  const seconds = (Date.now() - started) / 1000;

  const keys = w.email.keys();
  const unique = new Set(keys).size;
  // Sliding 1-second windows over the fake clock: at most capacity + refill*window sends.
  let worst = 0;
  for (let i = 0, j = 0; i < sendTimes.length; i++) {
    while ((sendTimes[i] ?? 0) - (sendTimes[j] ?? 0) >= 1000) j++;
    worst = Math.max(worst, i - j + 1);
  }
  const states = await q<{ s: string; n: number }>(`select send_state as s, count(*)::int as n from public.messages where tenant_id = $1 group by 1`, [w.tenantId]);
  const queued = await q(`select 1 from pgmq.q_followup_actions where message ->> 'tenant_id' = $1`, [w.tenantId]);
  console.log(JSON.stringify({ invoices: N, sends: keys.length, unique, rounds, worstPerSecond: worst, bucket: LIMIT, wallSeconds: Math.round(seconds), jobsPerSecond: Math.round(N / seconds), states }));

  expect(keys).toHaveLength(N);
  expect(unique).toBe(N); // no duplicates
  expect(worst).toBeLessThanOrEqual(LIMIT.capacity + LIMIT.refillPerSecond); // limiter respected
  expect(states).toEqual([{ s: 'sent', n: N }]);
  expect(queued).toHaveLength(0);
});
