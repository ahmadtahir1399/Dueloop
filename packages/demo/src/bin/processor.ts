// The demo's inbound processor: the production pipeline (processInboundBatch, planReplyOutcome, the state machine)
// with ONE difference: the deterministic scripted classifier from `pnpm demo:replies` instead of a model, so the demo
// needs no API key and gives the same result every time. Demo code only; refuses to run outside the demo.
import { processInboundBatch } from '@dueloop/inbound';
import { assertSchema, heartbeat } from '@dueloop/ops';
import { KeywordBaselineClassifier } from '../../../classifier/eval/keyword-baseline.ts';
import { buildInboundDeps } from '../../../worker/src/inbound-runtime.ts';
import { openDb } from '../../../worker/src/runtime.ts';
import { safetyProblems } from '../safety.ts';

if (process.env.DEMO_MODE !== '1' || safetyProblems(process.env).length) {
  console.error('the demo processor runs only under `pnpm demo` against the local stack');
  process.exit(1);
}
let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));

const db = openDb(process.env);
await assertSchema(db.pool);
const keyword = new KeywordBaselineClassifier('reply-v1');
const scripted = {
  promptVersion: 'demo-script',
  classify: async (input: Parameters<typeof keyword.classify>[0]) => {
    const r = await keyword.classify(input);
    return r.ok ? { ...r, modelId: 'demo-script', raw: { ...(r.raw as Record<string, unknown>), confidence: 0.95 } } : r;
  },
};
const clock = { now: () => new Date() };
const deps = buildInboundDeps(process.env, db, clock, scripted);

try {
  while (!stopping) {
    const totals: Record<string, number> = {};
    for (;;) {
      const r = await processInboundBatch(deps, { limit: 20 });
      for (const [k, n] of Object.entries(r.outcomes)) totals[k] = (totals[k] ?? 0) + n;
      if (r.claimed === 0 || stopping) break;
    }
    if (Object.keys(totals).length) process.stdout.write(`${JSON.stringify({ level: 'info', event: 'inbound_pass_done', totals })}\n`);
    await heartbeat(db.pool, 'processor', true, {}, new Date()).catch(() => undefined);
    for (let w = 0; w < 2000 && !stopping; w += 250) await new Promise((r) => setTimeout(r, 250));
  }
} finally {
  await db.pool.end();
}
