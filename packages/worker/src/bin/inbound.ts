// pnpm inbound --once | --loop [--tenant <id|name>] [--now <iso>]
// Drains the inbound event queue through the processor. Classifier: CLASSIFIER=anthropic or openai, plus
// CLASSIFIER_MODEL (a model id of that provider); otherwise every reply becomes a human task.
import { assertSchema, heartbeat } from '@dueloop/ops';
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
try {
  await assertSchema(db.pool);
} catch (e) {
  console.error(e instanceof Error ? e.message : 'schema check failed');
  await db.pool.end();
  process.exit(1);
}
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

async function beat() {
  try {
    report(await drain());
    await heartbeat(db.pool, 'processor', true, {}, new Date()).catch(() => undefined);
  } catch (e) {
    await heartbeat(db.pool, 'processor', false, { error: 'drain_failed' }, new Date()).catch(() => undefined);
    throw e;
  }
}
try {
  if (values.once) await beat();
  else
    while (!stopping) {
      await beat();
      for (let w = 0; w < 5000 && !stopping; w += 250) await new Promise((r) => setTimeout(r, 250));
    }
} finally {
  await db.pool.end();
}
