// pnpm inbound --once | --loop [--tenant <id|name>] [--now <iso>]
// Drains the inbound event queue through the processor. Classifier: CLASSIFIER=anthropic + CLASSIFIER_MODEL
// (e.g. claude-opus-5-5), otherwise every reply becomes a human task.
import { processInboundBatch } from '@dueloop/inbound';
import { parseArgs } from 'node:util';
import { buildInboundDeps, classifierFrom } from '../inbound-runtime.ts';
import { clockFrom, openDb, resolveTenant } from '../runtime.ts';

const { values } = parseArgs({ options: { once: { type: 'boolean', default: false }, loop: { type: 'boolean', default: false }, tenant: { type: 'string' }, now: { type: 'string' } } });
if (values.once === values.loop) {
  console.error('usage: pnpm inbound --once | --loop [--tenant <id|name>] [--now <iso>]');
  process.exit(2);
}
let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));

const db = openDb(process.env);
const clock = clockFrom(values.now);
const deps = buildInboundDeps(process.env, db, clock, classifierFrom(process.env, () => performance.now()));
const filter: Record<string, string> = values.tenant ? { tenant_id: await resolveTenant(db, values.tenant) } : {};

async function drain(): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (;;) {
    const r = await processInboundBatch(deps, { limit: 20, filter });
    for (const [k, n] of Object.entries(r.outcomes)) totals[k] = (totals[k] ?? 0) + n;
    if (r.claimed === 0 || stopping) return totals;
  }
}
const report = (totals: Record<string, number>) => process.stdout.write(`${JSON.stringify({ level: 'info', event: 'inbound_pass_done', at: clock.now().toISOString(), totals })}\n`);

try {
  if (values.once) report(await drain());
  else
    while (!stopping) {
      report(await drain());
      for (let w = 0; w < 5000 && !stopping; w += 250) await new Promise((r) => setTimeout(r, 250));
    }
} finally {
  await db.pool.end();
}
