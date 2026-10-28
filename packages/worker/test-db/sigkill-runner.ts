// Test-only worker process for the SIGKILL chaos test. Lives under test-db/ so no production entry point can
// reach the fake channel. Every adapter call is appended (synchronously) to SEND_LOG before it "sends".
import { appendFileSync } from 'node:fs';
import type { OutboundChannel, SendOutcome } from '@dueloop/messaging';
import { createJsonLogger } from '../src/logger.ts';
import { MemoryNotifier } from '../src/memory-notifier.ts';
import { DEFAULT_CONFIG, NO_FAILPOINTS } from '../src/ports.ts';
import { processBatch, type WorkerDeps } from '../src/process.ts';
import { db, pool } from './harness.ts';

const tenantId = process.env.TENANT_ID ?? '';
const now = new Date(process.env.NOW_ISO ?? '');
const sendLog = process.env.SEND_LOG ?? '';

const fileChannel: OutboundChannel = {
  channel: 'email',
  async send(env): Promise<SendOutcome> {
    appendFileSync(sendLog, `${env.idempotencyKey}\n`);
    await new Promise((r) => setTimeout(r, 15));
    return { kind: 'sent', providerMessageId: null };
  },
};

const deps: WorkerDeps = {
  db,
  clock: { now: () => new Date(now.getTime()) },
  channels: { get: (ch) => (ch === 'email' ? fileChannel : undefined) },
  notifier: new MemoryNotifier(),
  limiter: { tryTake: () => 0 },
  logger: createJsonLogger(() => undefined, () => now.toISOString()),
  failpoints: NO_FAILPOINTS,
  config: { ...DEFAULT_CONFIG, visibilitySeconds: 3, jitterMinutes: 0, releaseSeconds: 2 },
};

await db.enqueue(1000, now);
let empty = 0;
// Stop after three idle rounds spaced beyond the visibility timeout (jobs held by a killed process reappear).
// "Idle" includes rounds where every job was busy: a pending row left by the killed process is never resent;
// it waits for the stale sweep (driven by the test's clock, not this process).
while (empty < 3) {
  const r = await processBatch(deps, { limit: 5, filter: { tenant_id: tenantId } });
  const onlyBusy = Object.keys(r.outcomes).every((k) => k === 'busy');
  if (r.claimed === 0 || onlyBusy) {
    empty++;
    await new Promise((res) => setTimeout(res, 1500));
  } else {
    empty = 0;
  }
}
await pool.end();
