// Channel router: the channel to use for a policy step, or a typed reason why none can be used.
// The policy step decides the channel; there is NO fallback chain (out of scope; ADR 0019).
import type { Channel } from '@dueloop/core';
import { checkBudget } from './budget.ts';

export interface RouteInput {
  readonly stepChannel: Channel;
  readonly customer: { readonly email: string | null; readonly phoneE164: string | null };
  /** Channels with an active (not revoked) consent. */
  readonly consents: readonly Channel[];
  /** Enabled channel accounts of the tenant. */
  readonly accounts: readonly Channel[];
  readonly template: { readonly found: boolean; readonly providerStatus: string | null };
  readonly budgetMinor: number;
  readonly spentThisMonthMinor: number;
}

export type NoRouteReason =
  | 'no_contact' // the customer has no address for this channel -> step skipped
  | 'no_consent' // WhatsApp/SMS need an active consent -> step skipped
  | 'budget_exhausted' // paid channel over the monthly budget -> parked, owner alerted
  | 'template_missing' // -> parked, owner alerted
  | 'template_unapproved' // WhatsApp template not approved -> parked, owner alerted
  | 'account_missing'; // -> parked, owner alerted

export type Route = { readonly ok: true; readonly channel: Channel; readonly cost: number } | { readonly ok: false; readonly reason: NoRouteReason };

/** Which reasons skip the step (customer-side, permanent) and which park the invoice (tenant-side, fixable). */
export const SKIP_REASONS: readonly NoRouteReason[] = ['no_contact', 'no_consent'];

export function route(input: RouteInput): Route {
  const ch = input.stepChannel;
  const contact = ch === 'email' ? input.customer.email : input.customer.phoneE164;
  if (!contact) return { ok: false, reason: 'no_contact' };
  if (ch !== 'email' && !input.consents.includes(ch)) return { ok: false, reason: 'no_consent' };
  const budget = checkBudget(ch, input.budgetMinor, input.spentThisMonthMinor);
  if (!budget.ok) return { ok: false, reason: 'budget_exhausted' };
  if (!input.template.found) return { ok: false, reason: 'template_missing' };
  if (ch === 'whatsapp' && input.template.providerStatus !== 'approved') return { ok: false, reason: 'template_unapproved' };
  if (!input.accounts.includes(ch)) return { ok: false, reason: 'account_missing' };
  return { ok: true, channel: ch, cost: budget.cost };
}
