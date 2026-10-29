// Gateways per payment account, for every composition root (worker, webhook runtime, CLIs). Secrets come from
// Vault through our own rows; nothing here is ever logged.
import { FakeGateway, StripeGateway } from '@dueloop/adapters-payments';
import type { PaymentsDb } from './db.ts';
import type { Clock, PaymentGateway, ProviderRegistry } from './ports.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The fake provider exists only when PAYMENTS_ALLOW_FAKE=true (tests, demo) and never for a live-mode account.
 * Stripe needs both Vault secrets (restricted API key + webhook signing secret) and a key matching the mode.
 * Accounts whose secrets are missing get no gateway (their events are rejected; their links are not created).
 */
export function accountProviders(env: Env, db: PaymentsDb, clock: Clock): ProviderRegistry {
  // No cache (review round 2): secrets are updated in place in Vault and the mode can change, so a gateway cached
  // per account id kept a wrong signing secret or key until the process restarted. Two Vault reads per payment
  // event or link are cheap.
  return {
    async forAccount(a) {
      let gw: PaymentGateway | undefined;
      if (a.provider === 'fake' && env.PAYMENTS_ALLOW_FAKE === 'true' && a.mode === 'test') {
        const secret = await db.secret(a.id, 'webhook_secret');
        if (secret) gw = new FakeGateway({ secret, clock });
      }
      if (a.provider === 'stripe') {
        const [apiKey, webhookSecret] = await Promise.all([db.secret(a.id, 'api_key'), db.secret(a.id, 'webhook_secret')]);
        try {
          if (apiKey && webhookSecret) gw = new StripeGateway({ apiKey, webhookSecret, mode: a.mode, clock });
        } catch {
          gw = undefined; // key/mode mismatch: no gateway rather than a wrong-mode one
        }
      }
      return gw;
    },
  };
}
