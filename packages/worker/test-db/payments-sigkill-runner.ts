// Test-only payment processor for the SIGKILL chaos test (lives under test-db/, unreachable from production).
// Every applied receipt is appended synchronously to APPLY_LOG; a short pause after each plan keeps the batch
// long enough to be killed in the middle.
import { appendFileSync } from 'node:fs';
import { DEFAULT_PAYMENTS_CONFIG, processPaymentBatch, type PaymentsDeps } from '@dueloop/payments';
import { createJsonLogger } from '../src/logger.ts';
import { MemoryNotifier } from '../src/memory-notifier.ts';
import { pool } from './harness.ts';
import { paymentsDb } from './payments-harness.ts';

const tenantId = process.env.TENANT_ID ?? '';
const now = new Date(process.env.NOW_ISO ?? '');
const applyLog = process.env.APPLY_LOG ?? '';

const deps: PaymentsDeps = {
  db: paymentsDb,
  clock: { now: () => new Date(now.getTime()) },
  logger: createJsonLogger(() => undefined, () => now.toISOString()),
  notifier: new MemoryNotifier(),
  providers: { forAccount: async () => undefined },
  failpoints: {
    hit: async (name, ctx) => {
      if (name === 'after_plan') await new Promise((r) => setTimeout(r, 10));
      if (name === 'after_apply') appendFileSync(applyLog, `${ctx.eventId}\n`);
    },
  },
  config: { ...DEFAULT_PAYMENTS_CONFIG, visibilitySeconds: 3, retryBaseSeconds: 1 },
};

let empty = 0;
while (empty < 3) {
  const r = await processPaymentBatch(deps, { limit: 5, filter: { tenant_id: tenantId } });
  if (r.claimed === 0) {
    empty++;
    await new Promise((res) => setTimeout(res, 1500));
  } else empty = 0;
}
await pool.end();
