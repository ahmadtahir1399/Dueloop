// Evaluation harness: labelled set + recorded outputs => per-intent precision/recall, confusion matrix,
// threshold sweep, date accuracy, per-language breakdown. Pure functions; the scripts do the I/O.
import { REPLY_INTENTS, validatePromiseDate, type ReplyIntent } from '@dueloop/core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClassifierInput, inputHash, type ClassifierInput } from '../src/input.ts';
import type { Recording } from '../src/classifier.ts';
import { ReplyAnalysis } from '../src/schema.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DATA = path.join(ROOT, 'data/classifier');
/** Every labelled message was written on this date (Tuesday), in this zone. */
export const REFERENCE = new Date('2026-10-20T10:00:00Z');
export const ZONE = 'Europe/London';

export interface LabelledItem {
  readonly id: string;
  readonly text: string;
  readonly lang: string;
  readonly label: ReplyIntent;
  readonly expectedDate: string | null;
  readonly source: 'synthetic' | 'real';
}

export const readJsonl = <T>(file: string): T[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);

export function labelled(): LabelledItem[] {
  return readJsonl<LabelledItem>(path.join(DATA, 'labelled.jsonl'));
}

/** Exactly what the pipeline would show the model for this message (no customer names in the set). */
export function inputFor(item: LabelledItem): ClassifierInput {
  return buildClassifierInput({ text: item.text, reference: REFERENCE, timezone: ZONE, currency: 'GBP', localeHint: item.lang, redaction: { names: [], invoiceNumbers: [] } });
}

export interface RecordingLine extends Recording {
  readonly id: string;
}

export type Prediction = { readonly intent: ReplyIntent | 'invalid'; readonly confidence: number; readonly date: string | null; readonly vague: boolean };

export function predict(raw: unknown): Prediction {
  const p = ReplyAnalysis.safeParse(raw);
  if (!p.success) return { intent: 'invalid', confidence: 0, date: null, vague: false };
  return { intent: p.data.intent, confidence: p.data.confidence, date: p.data.promisedDate, vague: p.data.dateIsVague };
}

export interface EvalReport {
  readonly items: number;
  readonly missing: readonly string[];
  readonly accuracy: number;
  readonly macroF1: number;
  readonly perIntent: Readonly<Record<string, { precision: number; recall: number; f1: number; support: number }>>;
  readonly confusion: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly sweep: readonly { threshold: number; coverage: number; precision: number }[];
  readonly dates: { promises: number; exact: number; vagueCorrect: number; validated: number };
  readonly byLanguage: Readonly<Record<string, { items: number; accuracy: number; experimental: boolean }>>;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function evaluate(items: readonly LabelledItem[], recordings: readonly RecordingLine[], promptVersion: string): EvalReport {
  const byHash = new Map(recordings.map((r) => [r.hash, r]));
  const missing: string[] = [];
  const rows: { item: LabelledItem; pred: Prediction }[] = [];
  for (const item of items) {
    const rec = byHash.get(inputHash(inputFor(item), promptVersion));
    if (!rec) {
      missing.push(item.id);
      continue;
    }
    rows.push({ item, pred: predict(rec.raw) });
  }
  const classes = [...REPLY_INTENTS, 'invalid'];
  const confusion: Record<string, Record<string, number>> = Object.fromEntries(REPLY_INTENTS.map((g) => [g, Object.fromEntries(classes.map((c) => [c, 0]))]));
  for (const { item, pred } of rows) {
    const row = confusion[item.label];
    if (row) row[pred.intent] = (row[pred.intent] ?? 0) + 1;
  }
  const perIntent: Record<string, { precision: number; recall: number; f1: number; support: number }> = {};
  for (const intent of REPLY_INTENTS) {
    const tp = rows.filter((r) => r.item.label === intent && r.pred.intent === intent).length;
    const predicted = rows.filter((r) => r.pred.intent === intent).length;
    const support = rows.filter((r) => r.item.label === intent).length;
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    perIntent[intent] = { precision: r3(precision), recall: r3(recall), f1: r3(precision + recall ? (2 * precision * recall) / (precision + recall) : 0), support };
  }
  // Threshold sweep: auto-handle only predictions at or above t; how much is covered, and how often right.
  const sweep = [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9].map((threshold) => {
    const auto = rows.filter((r) => r.pred.intent !== 'invalid' && r.pred.confidence >= threshold);
    return { threshold, coverage: r3(rows.length ? auto.length / rows.length : 0), precision: r3(auto.length ? auto.filter((r) => r.pred.intent === r.item.label).length / auto.length : 0) };
  });
  const promises = rows.filter((r) => r.item.label === 'promise_to_pay');
  const dates = {
    promises: promises.length,
    exact: promises.filter((r) => r.item.expectedDate !== null && r.pred.date === r.item.expectedDate).length,
    vagueCorrect: promises.filter((r) => r.item.expectedDate === null && (r.pred.vague || r.pred.date === null)).length,
    // A predicted date only ever counts after the same check production applies (rule 26).
    validated: promises.filter((r) => r.pred.date !== null && validatePromiseDate(r.pred.date, REFERENCE, ZONE).ok).length,
  };
  const byLanguage: Record<string, { items: number; accuracy: number; experimental: boolean }> = {};
  for (const lang of [...new Set(rows.map((r) => r.item.lang))].sort()) {
    const lr = rows.filter((r) => r.item.lang === lang);
    byLanguage[lang] = { items: lr.length, accuracy: r3(lr.filter((r) => r.pred.intent === r.item.label).length / lr.length), experimental: lang !== 'en' };
  }
  const f1s = REPLY_INTENTS.map((i) => perIntent[i]?.f1 ?? 0);
  return {
    items: items.length,
    missing,
    accuracy: r3(rows.length ? rows.filter((r) => r.pred.intent === r.item.label).length / rows.length : 0),
    macroF1: r3(f1s.reduce((a, b) => a + b, 0) / f1s.length),
    perIntent,
    confusion,
    sweep,
    dates,
    byLanguage,
  };
}

export interface Baseline {
  readonly recording: string;
  readonly macroF1: number;
  readonly recall: Readonly<Record<string, number>>;
}

/** Regression gate: macro-F1 may not drop by more than 0.02, no intent's recall by more than 0.05. */
export function regressions(r: EvalReport, b: Baseline): string[] {
  const out: string[] = [];
  if (r.missing.length) out.push(`${r.missing.length} labelled item(s) have no recorded output (e.g. ${r.missing.slice(0, 3).join(', ')})`);
  if (r.macroF1 < b.macroF1 - 0.02) out.push(`macro-F1 ${r.macroF1} < baseline ${b.macroF1} - 0.02`);
  for (const [intent, recall] of Object.entries(b.recall)) {
    const now = r.perIntent[intent]?.recall ?? 0;
    if (now < recall - 0.05) out.push(`${intent} recall ${now} < baseline ${recall} - 0.05`);
  }
  return out;
}
