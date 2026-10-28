// toProposal: validated model output -> a core Proposal, or a typed reason for a human (issue C3).
// The model's confidence is NOT calibrated (issue C4): the per-intent minimums below are set from the labelled
// set by `pnpm classifier:eval` (see ADR 0029), not taken from the guide.
import type { Proposal, ReplyIntent } from '@dueloop/core';
import { ReplyAnalysis } from './schema.ts';

/** Marks attacker-controlled text. Consumers must render it as untrusted and never log or send it. */
export interface Untrusted<T> {
  readonly untrusted: T;
}

export type ToProposal =
  | { readonly kind: 'proposal'; readonly proposal: Proposal; readonly language: string; readonly summary: Untrusted<string> }
  | { readonly kind: 'review'; readonly reason: 'invalid_output' | 'low_confidence'; readonly intent: ReplyIntent | null; readonly summary: Untrusted<string> | null };

/** Below these, the proposal goes to a human. Chosen from the threshold sweep (ADR 0029). */
export const MIN_CONFIDENCE: Readonly<Record<ReplyIntent, number>> = {
  promise_to_pay: 0.6,
  already_paid: 0.6,
  dispute: 0.6,
  needs_info: 0.5,
  payment_plan_request: 0.5,
  wrong_person: 0.6,
  abusive: 0.5,
  unclear: 0,
  opt_out: 0.6,
};

export function toProposal(raw: unknown, minimums: Readonly<Record<ReplyIntent, number>> = MIN_CONFIDENCE): ToProposal {
  const parsed = ReplyAnalysis.safeParse(raw);
  if (!parsed.success) return { kind: 'review', reason: 'invalid_output', intent: null, summary: null };
  const a = parsed.data;
  const summary = { untrusted: a.summary };
  if (a.confidence < minimums[a.intent]) return { kind: 'review', reason: 'low_confidence', intent: a.intent, summary };
  return {
    kind: 'proposal',
    proposal: {
      intent: a.intent,
      confidence: a.confidence,
      promisedDate: a.intent === 'promise_to_pay' ? a.promisedDate : null,
      dateIsVague: a.dateIsVague,
      statedAmountText: a.statedAmountText,
    },
    language: a.language,
    summary,
  };
}
