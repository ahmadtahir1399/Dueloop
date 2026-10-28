import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, type Action, type Ctx } from '@dueloop/core';
import { describe, expect, it } from 'vitest';
import { checkSends, maxPerCustomerPerWeek } from '../src/checker.ts';
import { DEFAULT_START, runSimulation, type DecideFn } from '../src/engine.ts';
import type { SendRecord } from '../src/model.ts';
import { mulberry32 } from '../src/prng.ts';
import { formatText, summarize } from '../src/report.ts';
import { TENANTS } from '../src/scenario.ts';

const small = { days: 60, invoices: 150, seed: 7, start: DEFAULT_START };
const text = (o = small, d?: DecideFn) => formatText(summarize(runSimulation(o, d)));

describe('mulberry32', () => {
  it('same seed -> same sequence; different seed -> different sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(xs);
  });
  it('stays in range', () => {
    const r = mulberry32(1);
    for (let i = 0; i < 10_000; i++) {
      const x = r.next();
      expect(x >= 0 && x < 1).toBe(true);
      const n = r.int(3, 7);
      expect(Number.isInteger(n) && n >= 3 && n <= 7).toBe(true);
    }
  });
});

describe('simulation determinism', () => {
  it('same seed twice -> identical output', () => {
    expect(text()).toBe(text());
  });
  it('different seed -> different output', () => {
    expect(text({ ...small, seed: 8 })).not.toBe(text());
  });
});

describe('simulation with the real decide()', () => {
  it.each([
    ['spring DST window (default start)', DEFAULT_START, 1],
    ['spring DST window, other seed', DEFAULT_START, 99],
    ['autumn DST window', '2026-09-14T00:00:00Z', 5],
    ['year end', '2026-11-20T00:00:00Z', 123],
  ])('%s: zero invariant violations', (_name, start, seed) => {
    const r = runSimulation({ days: 90, invoices: 200, seed, start });
    expect(r.violations).toEqual([]);
    expect(r.sends.length).toBeGreaterThan(100);
  });

  it('exercises every status and every customer behaviour outcome', () => {
    const s = summarize(runSimulation({ days: 90, invoices: 500, seed: 42, start: DEFAULT_START }));
    for (const status of ['overdue', 'disputed', 'escalated', 'paid', 'written_off', 'cancelled']) {
      expect(s.byStatus[status], status).toBeGreaterThan(0);
    }
    expect(s.promises.kept).toBeGreaterThan(0);
    expect(s.promises.broken).toBeGreaterThan(0);
    expect(s.optOuts).toBeGreaterThan(0);
    expect(s.partialPayments).toBeGreaterThan(0);
    expect(Object.keys(s.recovered).sort()).toEqual(['GBP', 'INR', 'JPY', 'KWD', 'NPR', 'USD']);
  });

  it('has at least 3 zones, different quiet hours and a non-wrapping window', () => {
    expect(new Set(TENANTS.map((t) => t.settings.timezone)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(TENANTS.map((t) => `${t.settings.quietHours.startHour}-${t.settings.quietHours.endHour}`)).size).toBeGreaterThan(1);
    expect(TENANTS.some((t) => t.settings.quietHours.startHour < t.settings.quietHours.endHour)).toBe(true);
  });
});

describe('the invariant checker can fail (deliberately broken decide)', () => {
  const kinds = (d: DecideFn) => new Set(runSimulation(small, d).violations.map((v) => v.kind));

  it('ignoring quiet hours and holidays -> quiet_hours and holiday violations', () => {
    const broken: DecideFn = (c) => decide({ ...c, settings: { ...c.settings, quietHours: { startHour: 0, endHour: 0 }, holidays: [] } });
    const k = kinds(broken);
    expect(k.has('quiet_hours')).toBe(true);
    expect(k.has('holiday')).toBe(true);
  });

  it('ignoring opt-out -> opted_out violations', () => {
    expect(kinds((c) => decide({ ...c, customer: { optedOut: false } })).has('opted_out')).toBe(true);
  });

  // Heavy: the broken decide floods sends (3.6 s before prompt 4's extra invariants, ~5 s after).
  it('forgetting what was sent -> duplicate_key and weekly_cap violations', { timeout: 30_000 }, () => {
    const k = kinds((c) => decide({ ...c, history: { ...c.history, sentStepIds: [], sentAt: [] } }));
    expect(k.has('duplicate_key')).toBe(true);
    expect(k.has('weekly_cap')).toBe(true);
  });

  it('ignoring a no-contact status -> no_contact_status violations', () => {
    const k = kinds((c) => decide({ ...c, invoice: { ...c.invoice, status: c.invoice.status === 'disputed' ? 'overdue' : c.invoice.status } }));
    expect(k.has('no_contact_status')).toBe(true);
  });

  it('proposing a transition the state machine forbids -> illegal_transition', () => {
    const broken: DecideFn = (c: Ctx): Action[] => [{ kind: 'mark_overdue' }, ...decide(c)];
    expect(kinds(broken).has('illegal_transition')).toBe(true);
  });
});

describe('prompt 4 reply stage: invariants hold and can fail', () => {
  it('replies go through planReplyOutcome: tasks and reminder blocks happen, zero violations', () => {
    const r = runSimulation({ days: 90, invoices: 500, seed: 42, start: DEFAULT_START });
    expect(r.violations).toEqual([]);
    expect(r.stats.replyTasks).toBeGreaterThan(0);
    expect(r.stats.reminderBlocks).toBeGreaterThan(0);
    expect(r.stats.promisesMade).toBeGreaterThan(0);
  });
  it('ignoring reminder blocks -> blocked violations', () => {
    const r = runSimulation({ days: 90, invoices: 500, seed: 42, start: DEFAULT_START, faults: { ignoreBlocks: true } });
    expect(r.violations.some((v) => v.kind === 'blocked')).toBe(true);
  });
  it('ignoring promises -> promised_too_early violations', () => {
    const broken: DecideFn = (c) => decide(c.invoice.status === 'promised' ? { ...c, invoice: { id: c.invoice.id, status: 'overdue', dueOn: c.invoice.dueOn } } : c);
    expect(runSimulation({ days: 90, invoices: 500, seed: 42, start: DEFAULT_START }, broken).violations.some((v) => v.kind === 'promised_too_early')).toBe(true);
  });
  it('reviving opted-out customers -> opt_out_not_final violations', () => {
    const r = runSimulation({ days: 90, invoices: 500, seed: 42, start: DEFAULT_START, faults: { reviveOptOuts: true } });
    expect(r.violations.some((v) => v.kind === 'opt_out_not_final')).toBe(true);
  });
});

describe('checkSends()', () => {
  const nyc = new Map(TENANTS.filter((t) => t.id === 't-nyc').map((t) => [t.id, t])); // quiet 20->9, cap 2, holiday 2026-02-16
  const send = (iso: string, o: Partial<SendRecord> = {}): SendRecord => ({
    at: Date.parse(iso),
    tenantId: 't-nyc',
    customerId: 'c1',
    invoiceId: 'i1',
    stepId: 's1',
    channel: 'email',
    idempotencyKey: `i1:s1:${iso}`,
    statusAtSend: 'overdue',
    optedOutAtSend: false,
    promisedOnAtSend: undefined,
    blockedUntilAtSend: null,
    ...o,
  });

  it('accepts a clean send', () => {
    expect(checkSends([send('2026-02-10T15:00:00Z')], nyc)).toEqual([]); // 10:00 EST
  });
  it.each([
    ['quiet_hours', [send('2026-02-10T02:00:00Z')]], // 21:00 EST
    ['holiday', [send('2026-02-16T15:00:00Z')]],
    ['opted_out', [send('2026-02-10T15:00:00Z', { optedOutAtSend: true })]],
    ['no_contact_status', [send('2026-02-10T15:00:00Z', { statusAtSend: 'paid' })]],
    ['duplicate_key', [send('2026-02-10T15:00:00Z', { idempotencyKey: 'k' }), send('2026-02-11T15:00:00Z', { idempotencyKey: 'k' })]],
    ['weekly_cap', [send('2026-02-10T15:00:00Z'), send('2026-02-11T15:00:00Z'), send('2026-02-12T15:00:00Z')]],
  ] as const)('detects %s', (kind, sends) => {
    expect(checkSends(sends, nyc).map((v) => v.kind)).toEqual([kind]);
  });
  it.each([
    ['promised_too_early', [send('2026-02-10T15:00:00Z', { statusAtSend: 'promised', promisedOnAtSend: '2026-02-09' })]], // grace runs to 11 Feb
    ['blocked', [send('2026-02-10T15:00:00Z', { blockedUntilAtSend: Date.parse('2026-02-11T00:00:00Z') })]],
  ] as const)('detects %s (prompt 4)', (kind, sends) => {
    expect(checkSends(sends, nyc).map((v) => v.kind)).toEqual([kind]);
  });
  it('detects a send after an opt-out (prompt 4: opt-out is final)', () => {
    expect(checkSends([send('2026-02-10T15:00:00Z')], nyc, new Map([['c1', Date.parse('2026-02-09T00:00:00Z')]])).map((v) => v.kind)).toEqual(['opt_out_not_final']);
  });
  it('weekly cap window is (t - 168h, t]: a send exactly 168h earlier does not count', () => {
    const sends = [send('2026-02-10T15:00:00Z'), send('2026-02-11T15:00:00Z'), send('2026-02-17T15:00:00Z')];
    expect(checkSends(sends, nyc)).toEqual([]);
    expect(maxPerCustomerPerWeek(sends).count).toBe(2);
  });
});

describe('CLI', () => {
  const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli.ts');
  const run = (args: string[], tz?: string) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...(tz ? { TZ: tz } : {}) } });

  it('output is byte-identical whatever the host time zone', () => {
    const args = ['--days', '30', '--invoices', '60', '--seed', '3'];
    const outs = ['UTC', 'Asia/Karachi', 'America/Los_Angeles', 'Pacific/Chatham'].map((tz) => run(args, tz));
    for (const o of outs) expect(o.status).toBe(0);
    expect(new Set(outs.map((o) => o.stdout)).size).toBe(1);
  });
  it('--json is valid JSON and --trace prints a timeline', () => {
    const j = run(['--days', '20', '--invoices', '20', '--seed', '1', '--json', '--trace', 'inv-0001']);
    expect(j.status).toBe(0);
    const parsed = JSON.parse(j.stdout) as { violations: { total: number }; trace: { events: string[] } };
    expect(parsed.violations.total).toBe(0);
    expect(parsed.trace.events[0]).toContain('created');
    const t = run(['--days', '20', '--invoices', '20', '--seed', '1', '--trace', 'inv-0001']);
    expect(t.stdout).toContain('Trace inv-0001');
  });
  it.each([[['--days', 'x']], [['--bogus']], [['--start', 'not-a-date']]])('bad arguments %j -> exit 2', (args) => {
    expect(run(args).status).toBe(2);
  });
});
