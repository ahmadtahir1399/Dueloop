// Payment worlds for the loop, chaos and adversarial tests: the worker's world() plus a fake payment account
// (token hash + Vault secret), a FakeGateway on the test clock, and PaymentsDeps on the REAL database.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { FakeGateway, type FakeDelivery } from '@dueloop/adapters-payments';
import {
  confirmByHuman,
  createRequestFor,
  DEFAULT_PAYMENTS_CONFIG,
  ingestPaymentWebhook,
  NO_PAYMENT_FAILPOINTS,
  PaymentsDb,
  pollPending,
  processPaymentBatch,
  sweepRequests,
  type IngestResult,
  type PaymentsConfig,
  type PaymentsDeps,
} from '@dueloop/payments';
import { createJsonLogger } from '../src/logger.ts';
import { processReceiptBatch } from '../src/receipts.ts';
import { paymentLinks } from '../src/runtime.ts';
import type { WorkerDeps } from '../src/process.ts';
import { pool, q, world, type World, type WorldOptions } from './harness.ts';

export const paymentsDb = new PaymentsDb(pool);

type POver = Omit<Partial<PaymentsDeps>, 'config'> & { config?: Partial<PaymentsConfig> };

export interface PayWorld extends World {
  accountId: string;
  token: string;
  secret: string;
  gw: FakeGateway;
  pdeps: (over?: POver) => PaymentsDeps;
  /** Hand every due delivery to the webhook ingest (optionally duplicated/reversed). */
  deliver: (o?: { duplicate?: boolean; reverse?: boolean }) => Promise<IngestResult[]>;
  /** Drain the payment_events queue for this tenant. */
  process: (over?: POver) => Promise<Record<string, number>>;
  receipts: (over?: Partial<WorkerDeps>) => Promise<Record<string, number>>;
  link: (i?: number) => Promise<{ id: string; objectId: string; url: string | null; amount: number }>;
  manual: (i: number, amount: number, bankRef: string, paidAt?: Date) => Promise<{ outcome: string; receiptId: string }>;
  sweepRequests: () => Promise<{ retired: number; synced: number; failed: number }>;
  poll: () => Promise<{ checked: number; stored: number; failed: number }>;
  ownerId: string;
}

export async function payWorld(o: WorldOptions & { mode?: 'test' | 'live'; gatewayLive?: boolean } = {}): Promise<PayWorld> {
  const w = await world(o);
  const accountId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const secret = `whsec_${randomBytes(16).toString('hex')}`;
  await q(`insert into public.payment_accounts (id, tenant_id, provider, mode, webhook_token_hash) values ($1, $2, 'fake', $3, $4)`, [
    accountId,
    w.tenantId,
    o.mode ?? 'test',
    createHash('sha256').update(token).digest('hex'),
  ]);
  await q(`select private.set_payment_secret($1, 'webhook_secret', $2)`, [accountId, secret]);
  const ownerId = randomUUID();
  await q(`insert into auth.users (id, email) values ($1, $2)`, [ownerId, `owner-${ownerId.slice(0, 8)}@test-co.example`]);
  await q(`insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`, [w.tenantId, ownerId]);

  const gw = new FakeGateway({ secret, clock: w.clock, livemode: o.gatewayLive ?? false });
  const pdeps = (over: POver = {}): PaymentsDeps => ({
    db: paymentsDb,
    clock: w.clock,
    logger: createJsonLogger((l) => w.logs.push(l), () => w.clock.now().toISOString()),
    notifier: w.notifier,
    providers: { forAccount: async (a) => (a.id === accountId ? gw : undefined) },
    failpoints: NO_PAYMENT_FAILPOINTS,
    ...over,
    config: { ...DEFAULT_PAYMENTS_CONFIG, retryBaseSeconds: 0, ...over.config },
  });
  const filter = { tenant_id: w.tenantId };
  return {
    ...w,
    accountId,
    token,
    secret,
    gw,
    ownerId,
    pdeps,
    run: (over = {}) => w.run({ payments: paymentLinks(pdeps()), ...over }),
    deliver: async (d = {}) => {
      const out: IngestResult[] = [];
      for (const x of gw.drain(d) as FakeDelivery[]) out.push(await ingestPaymentWebhook(pdeps(), token, x.rawBody, x.headers));
      return out;
    },
    process: async (over = {}) => {
      const totals: Record<string, number> = {};
      for (;;) {
        const r = await processPaymentBatch(pdeps(over), { limit: 100, filter });
        for (const [k, n] of Object.entries(r.outcomes)) totals[k] = (totals[k] ?? 0) + n;
        if (r.claimed === 0) return totals;
      }
    },
    receipts: async (over = {}) => {
      const totals: Record<string, number> = {};
      for (let i = 0; i < 20; i++) {
        const r = await processReceiptBatch({ ...w.deps(), ...over }, { limit: 100, filter });
        for (const [k, n] of Object.entries(r.outcomes)) totals[k] = (totals[k] ?? 0) + n;
        if (r.claimed === 0 || Object.keys(r.outcomes).every((k) => k === 'released' || k === 'busy')) return totals;
      }
      return totals;
    },
    link: async (i = 0) => {
      const r = await createRequestFor(pdeps(), w.tenantId, w.invoiceIds[i] ?? '');
      if (!r.request?.providerObjectId) throw new Error(`no link: ${r.request ? 'no object' : r.reason}`);
      return { id: r.request.id, objectId: r.request.providerObjectId, url: r.request.url, amount: r.request.amountMinor };
    },
    manual: async (i, amount, bankRef, paidAt) => {
      const r = await confirmByHuman(pdeps(), {
        tenantId: w.tenantId,
        invoiceId: w.invoiceIds[i] ?? '',
        amountMinor: amount,
        currency: 'GBP',
        paidAt: paidAt ?? w.clock.now(),
        bankRef,
        userId: ownerId,
        source: 'manual',
        proofId: null,
        note: null,
      });
      return { outcome: r.outcome, receiptId: r.receiptId };
    },
    sweepRequests: () => sweepRequests(pdeps(), { tenantId: w.tenantId }),
    poll: () => pollPending(pdeps(), { tenantId: w.tenantId }),
  };
}

export const balanceOf = (invoiceId: string) => q<{ balance: string }>('select balance from public.invoice_balances where invoice_id = $1', [invoiceId]).then((r) => Number(r[0]?.balance));
export const statusOf = (invoiceId: string) => q<{ status: string }>('select status from public.invoices where id = $1', [invoiceId]).then((r) => r[0]?.status);
export const tasksOf = (tenantId: string) =>
  q<{ type: string; urgent: boolean; status: string; invoice_id: string | null }>('select type, urgent, status, invoice_id from public.tasks where tenant_id = $1 order by created_at, type', [tenantId]);
export const receiptsOf = (tenantId: string) => q<{ id: string; amount: string; source: string; provider_ref: string }>('select id, amount, source, provider_ref from public.receipts where tenant_id = $1 order by created_at', [tenantId]);
export const creditsOf = (tenantId: string) => q<{ amount: string }>('select amount from public.credits where tenant_id = $1', [tenantId]).then((r) => r.map((x) => Number(x.amount)));
export const tenantEventsOf = (tenantId: string) => q<{ type: string }>('select type from public.tenant_events where tenant_id = $1 order by created_at', [tenantId]).then((r) => r.map((x) => x.type));
export const outboxOf = (tenantId: string) =>
  q<{ idempotency_key: string; purpose: string; send_state: string; body: string | null; failed_reason: string | null }>(
    'select idempotency_key, purpose, send_state, body, failed_reason from public.messages where tenant_id = $1 and direction = $2 order by pending_since, idempotency_key',
    [tenantId, 'out'],
  );
export const integrityOf = (tenantId: string) => paymentsDb.integrity(tenantId);
