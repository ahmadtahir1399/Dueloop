// Replies (prompt 4): what a classifier may PROPOSE, and the pure bridge that turns a proposal into effects.
// The AI proposes, code decides (rule 5): only planReplyOutcome + the state machine change state from a reply,
// and no effect kind can send a message (rule 22). Pure: `reference` is an argument, luxon only.
import { DateTime } from 'luxon';
import { isFinal, transition, type InvoiceEvent } from './domain/invoiceState.ts';
import type { InvoiceStatus } from './domain/types.ts';

export const REPLY_INTENTS = [
  'promise_to_pay',
  'already_paid',
  'dispute',
  'needs_info',
  'payment_plan_request',
  'wrong_person',
  'abusive',
  'unclear',
  'opt_out',
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

/**
 * A classifier's proposal, already schema-validated (classifier's toProposal). Deliberately no free text:
 * the model's `summary` is attacker-controlled and never reaches planning (issue C6).
 */
export interface Proposal {
  readonly intent: ReplyIntent;
  /** The model's self-reported confidence, 0..1. NOT calibrated: a weak signal against a measured threshold. */
  readonly confidence: number;
  /** The model's reading of the promised date as 'YYYY-MM-DD'. Untrusted until validatePromiseDate (rule 26). */
  readonly promisedDate: string | null;
  /** The customer gave no concrete date ("soon", "next week or so"). */
  readonly dateIsVague: boolean;
  /** The amount as the customer wrote it. Parsed by code (ingest's parser), never by the model (issue C2). */
  readonly statedAmountText: string | null;
}

export type PromiseDateCheck =
  | { readonly ok: true; readonly date: string }
  | { readonly ok: false; readonly reason: 'missing' | 'invalid' | 'before_reference' | 'beyond_horizon' };

/** How far ahead a promised date may be (days after the reference local date). */
export const PROMISE_HORIZON_DAYS = 90;

/**
 * A model-supplied date is accepted only if it is a real calendar date on or after the customer's LOCAL date
 * at the reference time (when they wrote, issue K) and within the horizon.
 */
export function validatePromiseDate(date: string | null, reference: Date, timezone: string, horizonDays: number = PROMISE_HORIZON_DAYS): PromiseDateCheck {
  if (date === null) return { ok: false, reason: 'missing' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'invalid' };
  const d = DateTime.fromISO(date, { zone: timezone });
  if (!d.isValid || d.toISODate() !== date) return { ok: false, reason: 'invalid' };
  const today = DateTime.fromJSDate(reference).setZone(timezone).startOf('day');
  if (d.startOf('day') < today) return { ok: false, reason: 'before_reference' };
  if (d.startOf('day') > today.plus({ days: horizonDays })) return { ok: false, reason: 'beyond_horizon' };
  return { ok: true, date };
}

/** The stated amount after code parsed statedAmountText against the invoice currency. */
export type StatedAmount =
  | { readonly kind: 'none' }
  | { readonly kind: 'parsed'; readonly minor: number; readonly currency: string }
  | { readonly kind: 'unparsed' };

/** Task types a reply plan can create (the pipeline adds unmatched / ambiguous / unprocessed / delivery ones). */
export const PLAN_TASK_TYPES = ['review_promise', 'verify_payment_claim', 'dispute', 'info_request', 'human_review'] as const;
export type PlanTaskType = (typeof PLAN_TASK_TYPES)[number];

/** Why a human must look (issue C3: a typed union, not one generic string). */
export type ReviewReason =
  | 'payment_plan_request'
  | 'wrong_person'
  | 'abusive'
  | 'unclear'
  | 'low_confidence'
  | 'vague_date'
  | 'date_missing'
  | 'date_invalid'
  | 'date_before_reference'
  | 'date_beyond_horizon'
  | 'partial_amount'
  | 'currency_mismatch'
  | 'amount_unparsed'
  | 'unverified_sender'
  | 'renewal_cap'
  | 'promise_not_allowed_in_status'
  | 'promise_acceptance_review'
  | 'illegal_transition';

export type NotifyTopic = 'promise_recorded' | 'dispute' | 'payment_claim' | 'abusive' | 'opt_out';

/** The closed set of effect kinds. There is no kind that sends anything (rule 22). */
export const EFFECT_KINDS = ['transition', 'set_promise', 'create_task', 'record_opt_out', 'notify'] as const;

export type Effect =
  | { readonly kind: 'transition'; readonly event: InvoiceEvent; readonly from: InvoiceStatus; readonly to: InvoiceStatus }
  | { readonly kind: 'set_promise'; readonly promisedOn: string }
  | { readonly kind: 'create_task'; readonly type: PlanTaskType; readonly reason: ReviewReason | null; readonly blocksRemindersDays: number }
  | { readonly kind: 'record_opt_out' }
  | { readonly kind: 'notify'; readonly urgency: 'instant'; readonly topic: NotifyTopic };

export interface ReplyRules {
  /** 'auto': clear, trusted, confident promises move the invoice; 'review': every promise is a task (issue E). */
  readonly promiseAcceptance: 'auto' | 'review';
  /** Below this self-reported confidence a promise goes to a human. Set from the labelled set (issue C4). */
  readonly autoAcceptConfidence: number;
  readonly horizonDays: number;
  /** Promises already made on this invoice (broken or superseded) at which a new one goes to a human (issue G). */
  readonly maxRenewals: number;
  /** "Already paid": reminders pause this long while a human verifies (never closes the invoice). */
  readonly paymentClaimBlockDays: number;
  readonly infoRequestBlockDays: number;
}

export const DEFAULT_REPLY_RULES: ReplyRules = {
  promiseAcceptance: 'auto',
  autoAcceptConfidence: 0.8,
  horizonDays: PROMISE_HORIZON_DAYS,
  maxRenewals: 2,
  paymentClaimBlockDays: 3,
  infoRequestBlockDays: 3,
};

export interface ReplyPlanInput {
  readonly proposal: Proposal;
  /** The matched invoice (balance from the balance view), or null when no single invoice matched. */
  readonly invoice: { readonly status: InvoiceStatus; readonly balanceMinor: number; readonly currency: string } | null;
  /** When the customer wrote (issue K). */
  readonly reference: Date;
  readonly timezone: string;
  /**
   * The sender is proven: an email that threads to one of OUR outbound Message-IDs, or a provider-verified
   * WhatsApp number. Auto-effects need it; a spoofable sender only ever gets a task (issue J).
   */
  readonly senderTrusted: boolean;
  readonly statedAmount: StatedAmount;
  readonly activePromise: { readonly promisedOn: string } | null;
  readonly renewalCount: number;
  readonly rules: ReplyRules;
}

export interface ReplyPlan {
  readonly effects: readonly Effect[];
}

const reviewTask = (type: PlanTaskType, reason: ReviewReason | null, blocksRemindersDays = 0): Effect => ({ kind: 'create_task', type, reason, blocksRemindersDays });
const instant = (topic: NotifyTopic): Effect => ({ kind: 'notify', urgency: 'instant', topic });

function planPromise(i: ReplyPlanInput, inv: NonNullable<ReplyPlanInput['invoice']>): readonly Effect[] {
  const review = (reason: ReviewReason) => [reviewTask('review_promise', reason)];
  const p = i.proposal;
  if (!i.senderTrusted) return review('unverified_sender');
  // Promises are legal only from 'overdue' (state table); anything else needs a human, not a new transition.
  if (!transition(inv.status, 'promise_accepted').ok) return review('promise_not_allowed_in_status');
  if (p.dateIsVague) return review('vague_date');
  const date = validatePromiseDate(p.promisedDate, i.reference, i.timezone, i.rules.horizonDays);
  if (!date.ok) return review(date.reason === 'missing' ? 'date_missing' : date.reason === 'invalid' ? 'date_invalid' : `date_${date.reason}`);
  if (i.statedAmount.kind === 'unparsed') return review('amount_unparsed');
  if (i.statedAmount.kind === 'parsed') {
    if (i.statedAmount.currency !== inv.currency) return review('currency_mismatch');
    if (i.statedAmount.minor !== inv.balanceMinor) return review('partial_amount');
  }
  if (p.confidence < i.rules.autoAcceptConfidence) return review('low_confidence');
  if (i.renewalCount >= i.rules.maxRenewals) return review('renewal_cap');
  if (i.rules.promiseAcceptance === 'review') return review('promise_acceptance_review');
  const t = transition(inv.status, 'promise_accepted');
  if (!t.ok) return review('illegal_transition');
  return [{ kind: 'transition', event: 'promise_accepted', from: t.from, to: t.to }, { kind: 'set_promise', promisedOn: date.date }, instant('promise_recorded')];
}

/** The bridge: a validated proposal + current state => effects. Deterministic, total, never throws. */
export function planReplyOutcome(i: ReplyPlanInput): ReplyPlan {
  const p = i.proposal;
  // Opt-out only reduces messaging, so any matched sender may ask for it (issue J), with or without an invoice.
  if (p.intent === 'opt_out') return { effects: [{ kind: 'record_opt_out' }, instant('opt_out')] };
  const inv = i.invoice;
  if (!inv) return { effects: [] };
  if (isFinal(inv.status)) {
    // A closed invoice is never changed; a dispute about it still reaches a human.
    return { effects: p.intent === 'dispute' ? [reviewTask('dispute', null), instant('dispute')] : [] };
  }
  switch (p.intent) {
    case 'promise_to_pay':
      return { effects: planPromise(i, inv) };
    case 'already_paid':
      // NEVER a transition (rule 6). A proven sender pauses reminders briefly while a human verifies.
      return {
        effects: [
          reviewTask('verify_payment_claim', i.senderTrusted ? null : 'unverified_sender', i.senderTrusted ? i.rules.paymentClaimBlockDays : 0),
          instant('payment_claim'),
        ],
      };
    case 'dispute': {
      if (!i.senderTrusted) return { effects: [reviewTask('dispute', 'unverified_sender'), instant('dispute')] };
      const t = transition(inv.status, 'dispute_raised');
      if (!t.ok) return { effects: [reviewTask('dispute', 'illegal_transition'), instant('dispute')] };
      return { effects: [{ kind: 'transition', event: 'dispute_raised', from: t.from, to: t.to }, reviewTask('dispute', null), instant('dispute')] };
    }
    case 'needs_info':
      return { effects: [reviewTask('info_request', i.senderTrusted ? null : 'unverified_sender', i.senderTrusted ? i.rules.infoRequestBlockDays : 0)] };
    case 'abusive':
      return { effects: [reviewTask('human_review', 'abusive'), instant('abusive')] };
    case 'payment_plan_request':
    case 'wrong_person':
    case 'unclear':
      return { effects: [reviewTask('human_review', p.intent)] };
  }
}
