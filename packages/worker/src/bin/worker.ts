// pnpm worker --once | --loop [--tenant <id|name>] [--now <iso>] [--interval <seconds>]
import { parseArgs } from 'node:util';
import { processBatch, sweep } from '../process.ts';
import { processProofBatch } from '@dueloop/proofs';
import { pollPending, processPaymentBatch, sweepRequests } from '@dueloop/payments';
import { processReceiptBatch } from '../receipts.ts';
import { buildDeps, buildPaymentsDeps, buildProofsDeps, clockFrom, openDb, resolveTenant } from '../runtime.ts';

const { values } = parseArgs({
  options: {
    once: { type: 'boolean', default: false },
    loop: { type: 'boolean', default: false },
    tenant: { type: 'string' },
    now: { type: 'string' },
    interval: { type: 'string', default: '30' },
  },
});
if (values.once === values.loop) {
  console.error('usage: pnpm worker --once | --loop [--tenant <id|name>] [--now <iso>]');
  process.exit(2);
}
if (values.loop && values.now) {
  console.error('--now is for --once only (demos and reproductions); a looping worker uses the real clock');
  process.exit(2);
}

let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));

const db = openDb(process.env);
const deps = buildDeps(process.env, db, clockFrom(values.now));
const payments = buildPaymentsDeps(process.env, db, deps.clock);
const proofs = buildProofsDeps(process.env, db, deps.clock);
const filter: Record<string, string> = values.tenant ? { tenant_id: await resolveTenant(db, values.tenant) } : {};

/**
 * One full pass: enqueue due work, sweep stale state, then drain the queue. Jobs released by the rate limiter
 * come back within seconds, so the pass waits for them; it stops after 3 rounds without progress (a paused
 * tenant, or keys another worker holds), leaving those jobs for the next pass.
 */
async function pass(): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  await db.enqueue(500, deps.clock.now());
  await sweep(deps);
  let stalled = 0;
  let waiting = 0;
  while (stalled < 3 && !stopping) {
    const r = await processBatch(deps, { limit: 25, filter });
    if (r.claimed === 0 && waiting === 0) break;
    waiting = 0;
    let progressed = false;
    for (const [k, n] of Object.entries(r.outcomes)) {
      if (k === 'busy' || k === 'released') waiting += n;
      else {
        totals[k] = (totals[k] ?? 0) + n;
        progressed = true;
      }
    }
    stalled = progressed ? 0 : stalled + 1;
    if (!progressed) await new Promise((res) => setTimeout(res, 1200));
  }
  if (waiting) totals.left_for_next_pass = waiting;
  // Prompt 5: payment events (confirmations through the pipeline), request sweep + polling fallback, proofs.
  for (;;) {
    const r = await processPaymentBatch(payments, { limit: 25, filter });
    for (const [k, n] of Object.entries(r.outcomes)) totals[`payment_${k}`] = (totals[`payment_${k}`] ?? 0) + n;
    if (r.claimed === 0 || stopping) break;
  }
  const scope = filter.tenant_id ? { tenantId: filter.tenant_id } : {};
  await sweepRequests(payments, scope);
  const polled = await pollPending(payments, scope);
  if (polled.stored) totals.payment_polled = polled.stored;
  for (;;) {
    const r = await processProofBatch(proofs, { limit: 10, filter });
    for (const [k, n] of Object.entries(r.outcomes)) totals[`proof_${k}`] = (totals[`proof_${k}`] ?? 0) + n;
    if (r.claimed === 0 || stopping || Object.keys(r.outcomes).every((k) => k === 'retry')) break;
  }
  // Receipts (prompt 5): the transactional queue, same outbox rules, no decide().
  for (;;) {
    const r = await processReceiptBatch(deps, { limit: 25, filter });
    for (const [k, n] of Object.entries(r.outcomes)) totals[`receipt_${k}`] = (totals[`receipt_${k}`] ?? 0) + n;
    if (r.claimed === 0 || stopping || Object.keys(r.outcomes).every((k) => k === 'busy' || k === 'released')) break;
  }
  return totals;
}

/** Counts only (no ids, no contact details): one machine-readable line per pass. */
const report = (totals: Record<string, number>) => process.stdout.write(`${JSON.stringify({ level: 'info', event: 'pass_done', at: deps.clock.now().toISOString(), totals })}
`);


try {
  if (values.once) {
    report(await pass());
  } else {
    const ms = Math.max(5, Number(values.interval)) * 1000;
    while (!stopping) {
      report(await pass());
      for (let waited = 0; waited < ms && !stopping; waited += 250) await new Promise((r) => setTimeout(r, 250));
    }
  }
} finally {
  await db.pool.end();
}
