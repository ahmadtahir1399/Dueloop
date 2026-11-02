// pnpm mailbox --once | --loop [--tenant <id|name>] [--now <iso>] [--interval <seconds>]
// Reads the mailboxes businesses connected (Settings > Integrations) and stores what is about their customers; the
// processor (pnpm inbound) takes it from there. It connects to servers businesses chose, so it only reads when the
// operator sets IMAP_ALLOW_TENANT_HOST=true; otherwise it idles.
import { assertSchema, heartbeat } from '@dueloop/ops';
import { parseArgs } from 'node:util';
import { pollDueMailboxes } from '../mailbox.ts';
import { buildMailboxDeps, clockFrom, openDb, resolveTenant } from '../runtime.ts';

const { values } = parseArgs({ options: { once: { type: 'boolean', default: false }, loop: { type: 'boolean', default: false }, tenant: { type: 'string' }, now: { type: 'string' }, interval: { type: 'string', default: '60' } } });
if (values.once === values.loop) {
  console.error('usage: pnpm mailbox --once | --loop [--tenant <id|name>] [--now <iso>] [--interval <seconds>]');
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
const deps = buildMailboxDeps(process.env, db, clock);
const tenantId = values.tenant ? await resolveTenant(db, values.tenant) : null;
const enabled = process.env.IMAP_ALLOW_TENANT_HOST === 'true';

/** Counts only: one machine-readable line per pass. */
async function beat() {
  try {
    const totals = enabled ? await pollDueMailboxes(deps, tenantId) : {};
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'mailbox_pass_done', at: clock.now().toISOString(), enabled, totals })}\n`);
    await heartbeat(db.pool, 'mailbox', true, { enabled }, new Date()).catch(() => undefined);
  } catch (e) {
    await heartbeat(db.pool, 'mailbox', false, { error: 'pass_failed' }, new Date()).catch(() => undefined);
    throw e;
  }
}
try {
  if (values.once) await beat();
  else {
    const ms = Math.max(30, Number(values.interval)) * 1000;
    while (!stopping) {
      await beat();
      for (let w = 0; w < ms && !stopping; w += 250) await new Promise((r) => setTimeout(r, 250));
    }
  }
} finally {
  await db.pool.end();
}
