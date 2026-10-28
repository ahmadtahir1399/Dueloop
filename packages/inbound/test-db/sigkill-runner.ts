// Test-only inbound processor process for the SIGKILL chaos test (lives under test-db/, never reachable from
// production code). Scripted classifier: "pay on YYYY-MM-DD" => a promise for that date.
import { FakeClassifier } from '@dueloop/classifier';
import { processInboundBatch } from '../src/pipeline.ts';
import { DEFAULT_INBOUND_CONFIG, NO_INBOUND_FAILPOINTS, type InboundDeps } from '../src/ports.ts';
import { analysis, db, pool } from './harness.ts';

const tenantId = process.env.TENANT_ID ?? '';
const now = new Date(process.env.NOW_ISO ?? '');

const deps: InboundDeps = {
  db,
  classifier: new FakeClassifier((input) => {
    const d = /pay on (\d{4}-\d{2}-\d{2})/.exec(input.text)?.[1];
    return d ? analysis('promise_to_pay', { promisedDate: d }) : analysis('unclear');
  }),
  clock: { now: () => new Date(now.getTime()) },
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  notifier: { notify: async () => new Promise((r) => setTimeout(r, 5)) },
  failpoints: NO_INBOUND_FAILPOINTS,
  config: { ...DEFAULT_INBOUND_CONFIG, visibilitySeconds: 3, retryBaseSeconds: 1 },
};

let idle = 0;
while (idle < 3) {
  const r = await processInboundBatch(deps, { limit: 5, filter: { tenant_id: tenantId } });
  if (r.claimed === 0) {
    idle++;
    await new Promise((res) => setTimeout(res, 1500));
  } else idle = 0;
}
await pool.end();
