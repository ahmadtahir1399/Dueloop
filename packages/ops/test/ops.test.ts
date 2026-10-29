import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, EXPECTED_SCHEMA_VERSION, evaluate, scrub, summarise, type Heartbeat, type OpsStatus } from '../src/index.ts';

describe('schema version constant (rule 45)', () => {
  it('is the newest migration in supabase/migrations', () => {
    const files = readdirSync(path.resolve(import.meta.dirname, '../../../supabase/migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(EXPECTED_SCHEMA_VERSION).toBe(files.at(-1)?.slice(0, 4));
  });
});

const base: OpsStatus = {
  schema_version: EXPECTED_SCHEMA_VERSION,
  queue_depth: 0,
  queue_oldest_seconds: 0,
  due_not_enqueued: 0,
  parked_invoices: 0,
  unknown_messages: 0,
  dead_letters_24h: 0,
  pending_approvals: 0,
  oldest_pending_approval_hours: 0,
  unprocessed_inbound: 0,
  unprocessed_payment_events: 0,
  paused_tenants: 0,
  global_paused: false,
  heartbeats: [{ service: 'worker', instance: 'h:1', version: '0.6.0', seen_seconds_ago: 20, ok_seconds_ago: 20 }],
};

describe('watchdog evaluation', () => {
  it('a healthy system has no findings', () => {
    expect(evaluate(base)).toEqual([]);
  });
  it('a dead worker (stale or missing heartbeat) is critical', () => {
    const stale: Heartbeat = { service: 'worker', instance: 'h:1', version: '0.6.0', seen_seconds_ago: 900, ok_seconds_ago: 900 };
    expect(evaluate({ ...base, heartbeats: [stale] })[0]).toMatchObject({ key: 'heartbeat:worker', severity: 'critical' });
    expect(evaluate({ ...base, heartbeats: [] })[0]?.message).toBe('worker: never reported a heartbeat');
  });
  it('thresholds raise findings with counts only', () => {
    const f = evaluate({ ...base, unknown_messages: 2, queue_oldest_seconds: 3600, unprocessed_payment_events: 60 });
    expect(f.map((x) => x.key).sort()).toEqual(['queue_oldest', 'unknown_messages', 'unprocessed_payment_events']);
    expect(DEFAULT_THRESHOLDS.required).toContain('worker');
  });
});

describe('error scrubber (hostile input)', () => {
  it('removes secrets, tokens, contact details and caps bodies', () => {
    const hostile = [
      `connect failed postgresql://postgres:${'hunter2'}@db.example.com:5432/postgres`,
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'key dl_ab12cd34_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEf sk_live_51Habc whsec_abc123',
      'GET /p/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEf and /webhooks/payments/AbCdEfGhIjKlMnOpQrStUvWxYz012',
      'customer anna.k@example.org +44 20 7946 0958 said: ' + 'x'.repeat(2000),
    ].join(' | ');
    const out = scrub(hostile);
    for (const leak of ['hunter2', 'eyJhbGci', 'dl_ab12cd34', 'sk_live_', 'whsec_abc', 'AbCdEfGhIjKlMnOp', 'anna.k@', '7946']) expect(out).not.toContain(leak);
    expect(out.length).toBeLessThanOrEqual(520);
    expect(out).toContain('[truncated]');
  });
  it('summarise never includes a stack', () => {
    const e = new Error('boom for bob@example.com');
    expect(summarise(e)).toBe('Error: boom for [email]');
  });
});

describe('version (prompt 7 step 13)', () => {
  it('APP_VERSION (heartbeats, /ready) equals the root package.json version', async () => {
    const { readFileSync } = await import('node:fs');
    const { APP_VERSION } = await import('../src/index.ts');
    const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../package.json'), 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});
