// Gateways per payment account, for every composition root (worker, webhook runtime, CLIs). Secrets come from
// Vault through our own rows; nothing here is ever logged.
import { FakeGateway } from '@dueloop/adapters-payments';
import type { PaymentsDb } from './db.ts';
import type { Clock, PaymentGateway, ProviderRegistry } from './ports.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The fake provider exists only when PAYMENTS_ALLOW_FAKE=true (tests, demo) and never for a live-mode account.
 * Accounts whose secret is missing get no gateway (their events are rejected; their links are not created).
 */
export function accountProviders(env: Env, db: PaymentsDb, clock: Clock): ProviderRegistry {
  const cache = new Map<string, PaymentGateway>();
  return {
    async forAccount(a) {
      const hit = cache.get(a.id);
      if (hit) return hit;
      let gw: PaymentGateway | undefined;
      if (a.provider === 'fake' && env.PAYMENTS_ALLOW_FAKE === 'true' && a.mode === 'test') {
        const secret = await db.secret(a.id, 'webhook_secret');
        if (secret) gw = new FakeGateway({ secret, clock });
      }
      if (gw) cache.set(a.id, gw);
      return gw;
    },
  };
}
