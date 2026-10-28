// A deterministic KEYWORD BASELINE "classifier". It exists so the evaluation harness, the metrics and the CI
// regression gate can run without a model or credentials. Its numbers say nothing about any LLM's accuracy.
// Output has the exact ReplyAnalysis shape, like a model's.
import { DateTime } from 'luxon';
import type { ClassifierResult, ReplyClassifier } from '../src/classifier.ts';
import type { ClassifierInput } from '../src/input.ts';

const has = (t: string, words: readonly string[]) => words.some((w) => t.includes(w));

const RULES: readonly { intent: string; confidence: number; words: readonly string[] }[] = [
  { intent: 'opt_out', confidence: 0.9, words: ['unsubscribe', 'stop messaging', 'stop calling', 'stop texting', 'remove me', "don't contact", 'no more messages', 'opt out', "don't want to receive", 'take my number off', 'abmelden', 'arrêtez', 'band karo'] },
  { intent: 'abusive', confidence: 0.85, words: ['idiot', 'crook', 'go to hell', 'parasite', 'moron', 'pathetic', 'scumbag', 'regret it', 'betrüger', 'estafador', 'escroc', 'chor log', 'see what happens', 'bankrupt', 'clowns'] },
  { intent: 'wrong_person', confidence: 0.8, words: ['wrong person', 'wrong number', 'wrong email', "don't know your company", 'never heard of', 'left that company', "this isn't me", 'receptionist', 'partner handles', 'contact our finance', 'falsche person', 'equivocado', 'trompez', 'ghalat number'] },
  { intent: 'payment_plan_request', confidence: 0.8, words: ['instalment', 'installment', 'split it', 'monthly payments', 'payment plan', 'half now', 'a week until', 'spread the cost', 'two payments', 'raten', 'cuotas', 'plusieurs fois', 'qiston', 'agree a schedule', 'bit by bit'] },
  { intent: 'already_paid', confidence: 0.85, words: ['already paid', 'paid yesterday', 'transfer went out', 'settled this on', 'paid in full', 'payment was sent', 'i paid', 'has been paid', 'paid it on', 'money left our account', 'bezahlt', 'pagada', 'déjà payé', 'payment ho chuki', 'paid. obviously', 'sent it on', 'invoice is paid'] },
  { intent: 'dispute', confidence: 0.8, words: ['wrong', 'incorrect', 'never ordered', 'never completed', 'charged us twice', 'returned these', 'dispute', "doesn't match", 'overcharged', 'cancelled this order', 'falsch', 'incorrecta', 'erronée', 'ghalat', "didn't do", 'discount'] },
  { intent: 'needs_info', confidence: 0.75, words: ['copy', 'bank details', 'po number', 'resend', 'receipt', 'reference i should', 'breakdown', 'payment link', 'transfer out to', 'which invoice', 'schicken', 'datos bancarios', 'bhej dein', 'pdf', 'attachment'] },
  { intent: 'promise_to_pay', confidence: 0.75, words: ['pay', 'transfer', 'settle', 'expect the money', 'zahle', 'zahlung', 'pagaré', 'paierai', 'payment kar'] },
];

const VAGUE = ['soon', 'end of the month', 'few days', 'next week', 'once my', 'when i can'];
const WEEKDAYS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7,
  montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, lundi: 1, vendredi: 5, lunes: 1, viernes: 5,
};
const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** Reads a date the way the prompt asks the model to: relative to the reference local date. */
export function baselineDate(text: string, referenceDate: string, timezone: string): { date: string | null; vague: boolean } {
  const t = text.toLowerCase();
  if (has(t, VAGUE)) return { date: null, vague: true };
  const ref = DateTime.fromISO(referenceDate, { zone: timezone });
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t)?.[1];
  if (iso) return { date: iso, vague: false };
  if (t.includes('tomorrow')) return { date: ref.plus({ days: 1 }).toISODate(), vague: false };
  for (const [name, wd] of Object.entries(WEEKDAYS)) {
    if (t.includes(name)) return { date: ref.plus({ days: ((wd - ref.weekday + 7) % 7) || 7 }).toISODate(), vague: false };
  }
  const dm = /\b(\d{1,2})\.(\d{1,2})\.?/.exec(t);
  if (dm) return { date: ref.set({ month: Number(dm[2]), day: Number(dm[1]) }).toISODate(), vague: false };
  for (const [name, m] of Object.entries(MONTHS)) {
    const r = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${name}\\b`).exec(t);
    if (r) return { date: ref.set({ month: m, day: Number(r[1]) }).toISODate(), vague: false };
  }
  const day = /\b(?:the\s+|el día\s+|día\s+)?(\d{1,2})(?:st|nd|rd|th)\b|\bel día (\d{1,2})\b/.exec(t);
  const d = Number(day?.[1] ?? day?.[2] ?? 0);
  if (d >= 1 && d <= 31) {
    const thisMonth = ref.set({ day: d });
    return { date: (d >= ref.day ? thisMonth : thisMonth.plus({ months: 1 })).toISODate(), vague: false };
  }
  return { date: null, vague: false };
}

export function keywordAnalysis(input: ClassifierInput): Record<string, unknown> {
  const t = input.text.toLowerCase();
  const rule = RULES.find((r) => has(t, r.words));
  const intent = rule?.intent ?? 'unclear';
  const date = intent === 'promise_to_pay' ? baselineDate(input.text, input.referenceDate, input.timezone) : { date: null, vague: false };
  return {
    intent,
    confidence: rule ? (intent === 'promise_to_pay' && !date.date && !date.vague ? 0.55 : rule.confidence) : 0.5,
    promisedDate: date.date,
    promisedDateText: null,
    dateIsVague: date.vague,
    statedAmountText: /£\s?\d[\d,.]*/.exec(input.text)?.[0] ?? null,
    language: 'en',
    summary: `keyword baseline: ${intent}`,
  };
}

export class KeywordBaselineClassifier implements ReplyClassifier {
  readonly promptVersion: string;
  constructor(promptVersion: string) {
    this.promptVersion = promptVersion;
  }
  async classify(input: ClassifierInput): Promise<ClassifierResult> {
    return { ok: true, raw: keywordAnalysis(input), modelId: 'keyword-baseline', promptVersion: this.promptVersion, latencyMs: 0, tokensIn: null, tokensOut: null };
  }
}
