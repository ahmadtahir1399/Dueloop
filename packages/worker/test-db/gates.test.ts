// Prompt 4 worker gates: blocking tasks (pre-decide and final), a reply/opt-out arriving between decide() and
// the send (issue L, via prompt 3's failpoints), 'low_confidence' approvals (issue N), broken promises (G).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Failpoints, FailpointName } from '../src/ports.ts';
import { eventsOf, invoice, messagesOf, pool, q, quietCron, world } from './harness.ts';

beforeAll(quietCron);
afterAll(() => pool.end());

const addTask = (tenantId: string, invoiceId: string, until: string, type = 'verify_payment_claim') =>
  q(`insert into public.tasks (tenant_id, type, invoice_id, blocks_reminders_until, dedupe_key, created_at) values ($1, $2, $3, $4, $5, now())`, [
    tenantId,
    type,
    invoiceId,
    until,
    `test:${invoiceId}:${type}:${until}`,
  ]);

/** A failpoint that does not crash but runs `inject` once when `point` is reached. */
const injectAt = (point: FailpointName, inject: () => Promise<unknown>): Failpoints => {
  let done = false;
  return {
    async hit(name) {
      if (name === point && !done) {
        done = true;
        await inject();
      }
    },
  };
};

describe('blocking tasks', () => {
  it('an open, unexpired blocking task => nothing sent, next action = its expiry; on expiry: one alert, then normal', async () => {
    const w = await world();
    const id = w.invoiceIds[0] ?? '';
    await addTask(w.tenantId, id, '2026-06-13T09:00:00Z');
    expect((await w.run()).outcomes).toEqual({ blocked: 1 });
    expect(w.email.calls).toHaveLength(0);
    expect((await invoice(id))?.next_action_at.toISOString()).toBe('2026-06-13T09:00:00.000Z');

    w.clock.set('2026-06-13T09:30:00Z');
    await w.run();
    expect(w.email.calls).toHaveLength(1);
    expect(w.notifier.alerts.filter((a) => a.kind === 'reminders_resumed')).toHaveLength(1);
    expect((await eventsOf(w.tenantId)).map((e) => e.type)).toContain('RemindersResumed');
    await q('update public.invoices set next_action_at = $2 where id = $1', [id, w.clock.now()]);
    await w.run();
    expect(w.notifier.alerts.filter((a) => a.kind === 'reminders_resumed')).toHaveLength(1); // once
  });

  it('a RESOLVED task does not block', async () => {
    const w = await world();
    await addTask(w.tenantId, w.invoiceIds[0] ?? '', '2026-06-13T09:00:00Z');
    await q(`update public.tasks set status = 'resolved', resolved_at = now() where tenant_id = $1`, [w.tenantId]);
    await w.run();
    expect(w.email.calls).toHaveLength(1);
  });
});

describe('issue L: something arrives between decide() and the send => zero sends', () => {
  it.each<[string, (w: Awaited<ReturnType<typeof world>>) => Promise<unknown>, string]>([
    ['an opt-out', (w) => q('update public.customers set opted_out = true where id = $1', [w.customerId]), 'no_action'],
    ['a blocking task (e.g. "already paid")', (w) => addTask(w.tenantId, w.invoiceIds[0] ?? '', '2026-06-13T09:00:00Z'), 'blocked'],
    ['the tenant kill switch', (w) => q('update public.tenants set outbound_paused = true where id = $1', [w.tenantId]), 'released'],
  ])('%s', async (_n, arrive, outcome) => {
    const w = await world();
    const r = await w.run({ failpoints: injectAt('after_pending_insert', () => arrive(w)) });
    expect(w.email.calls).toHaveLength(0);
    expect(r.outcomes).toEqual({ [outcome]: 1 });
    // The claim is given back: provably not sent, retryable under the same key, attempt not consumed.
    const [m] = await messagesOf(w.tenantId);
    expect(m).toMatchObject({ send_state: 'retry', attempt: 0, failed_reason: expect.stringMatching(/^gate_/) });
  });

  it('...and after the block ends, the same key is sent exactly once', async () => {
    const w = await world();
    await w.run({ failpoints: injectAt('after_pending_insert', () => addTask(w.tenantId, w.invoiceIds[0] ?? '', '2026-06-13T09:00:00Z')) });
    w.clock.set('2026-06-13T10:00:00Z');
    await w.run();
    await w.run();
    expect(w.email.keys()).toEqual([`${w.invoiceIds[0]}:s1:email`]);
    expect((await messagesOf(w.tenantId))[0]).toMatchObject({ send_state: 'sent', attempt: 1 });
  });
});

describe("issue N: approval_mode 'low_confidence'", () => {
  it('no unresolved doubt => sends without approval', async () => {
    const w = await world({ approvalMode: 'low_confidence' });
    await w.run();
    expect(w.email.calls).toHaveLength(1);
  });

  it('an open human_review task on the invoice => approval required', async () => {
    const w = await world({ approvalMode: 'low_confidence' });
    await q(`insert into public.tasks (tenant_id, type, reason, invoice_id, dedupe_key, created_at) values ($1, 'human_review', 'unclear', $2, 'n1', now())`, [w.tenantId, w.invoiceIds[0]]);
    expect((await w.run()).outcomes).toEqual({ approval_requested: 1 });
    expect(w.email.calls).toHaveLength(0);
  });

  it("the customer's recent low-confidence reply (any invoice) => approval required", async () => {
    const w = await world({ approvalMode: 'low_confidence' });
    await q(`insert into public.tasks (tenant_id, type, reason, customer_id, dedupe_key, created_at) values ($1, 'human_review', 'low_confidence', $2, 'n2', $3)`, [
      w.tenantId,
      w.customerId,
      '2026-06-05T09:00:00Z',
    ]);
    expect((await w.run()).outcomes).toEqual({ approval_requested: 1 });
  });
});

describe('issue G: a broken promise ends the promise row', () => {
  it("decide()'s mark_promise_broken sets the active promise to 'broken'", async () => {
    const w = await world();
    const id = w.invoiceIds[0] ?? '';
    await q(`update public.invoices set status = 'overdue' where id = $1`, [id]);
    await q(`update public.invoices set status = 'promised', promised_on = '2026-06-05' where id = $1`, [id]);
    await q(`insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, reference_at) values ($1, $2, $3, '2026-06-05', '2026-06-02T09:00:00Z')`, [w.tenantId, id, w.customerId]);
    await w.run(); // 10 June > 5 June + 2 days grace
    expect((await invoice(id))?.status).toBe('overdue');
    expect((await q<{ status: string }>('select status from public.promises where invoice_id = $1', [id]))[0]?.status).toBe('broken');
  });
});
