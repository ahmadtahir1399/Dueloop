// pnpm classifier:eval [--recording <file>] [--update-baseline]
// Replays RECORDED outputs (no network, no cost) against the labelled set and fails on regression versus the
// committed baseline. IMPORTANT: the labelled set is SYNTHETIC (written for this repo by an AI). It is a
// regression guard, NOT a measure of accuracy on real customer messages.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CURRENT_PROMPT_VERSION } from '../src/prompt.ts';
import { DATA, evaluate, labelled, readJsonl, regressions, type Baseline, type RecordingLine } from './harness.ts';

const { values } = parseArgs({ options: { recording: { type: 'string' }, 'update-baseline': { type: 'boolean', default: false } } });
const baselineFile = path.join(DATA, 'baseline.json');
const baseline = existsSync(baselineFile) ? readJsonl<Baseline>(baselineFile)[0] : undefined;
const recordingFile = values.recording ?? path.join(DATA, baseline?.recording ?? `recorded/${CURRENT_PROMPT_VERSION}/keyword-baseline.jsonl`);
const recordings = readJsonl<RecordingLine>(path.resolve(DATA, recordingFile));
const models = [...new Set(recordings.map((r) => r.modelId))];
const items = labelled();
const r = evaluate(items, recordings, CURRENT_PROMPT_VERSION);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(7);
const out: string[] = [];
out.push(`Classifier eval  prompt=${CURRENT_PROMPT_VERSION}  recorded outputs from: ${models.join(', ')}  (${path.relative(DATA, path.resolve(DATA, recordingFile))})`);
out.push(`Labelled set: ${items.length} messages, ${items.filter((i) => i.source === 'synthetic').length} SYNTHETIC, ${items.filter((i) => i.source === 'real').length} real.`);
out.push('NOTE: synthetic data is a regression guard, not a measure of real-world accuracy. The 150-real-messages-per-language gate is NOT MET.');
if (models.includes('keyword-baseline')) out.push('NOTE: these outputs come from the deterministic KEYWORD BASELINE, not a model. Run `pnpm eval:live` to record a real model.');
out.push('');
out.push(`accuracy ${pct(r.accuracy)}   macro-F1 ${r.macroF1.toFixed(3)}   missing recordings ${r.missing.length}`);
out.push('');
out.push(`${'intent'.padEnd(22)}${'precision'.padStart(10)}${'recall'.padStart(9)}${'F1'.padStart(8)}${'n'.padStart(5)}`);
for (const [intent, m] of Object.entries(r.perIntent)) out.push(`${intent.padEnd(22)}${pct(m.precision).padStart(10)}${pct(m.recall).padStart(9)}${m.f1.toFixed(3).padStart(8)}${String(m.support).padStart(5)}`);
out.push('');
const cols = Object.keys(Object.values(r.confusion)[0] ?? {});
const abbr = (s: string) => s.replace('payment_plan_request', 'plan').replace('promise_to_pay', 'promise').replace('already_paid', 'paid').replace('wrong_person', 'wrong').replace('needs_info', 'info').replace('opt_out', 'optout');
out.push(`Confusion (rows = label, columns = predicted)`);
out.push(`${''.padEnd(10)}${cols.map((c) => abbr(c).slice(0, 7).padStart(8)).join('')}`);
for (const [label, row] of Object.entries(r.confusion)) out.push(`${abbr(label).slice(0, 9).padEnd(10)}${cols.map((c) => String(row[c] ?? 0).padStart(8)).join('')}`);
out.push('');
out.push('Threshold sweep (auto-handle only at or above the threshold)');
out.push(`${'threshold'.padEnd(12)}${'coverage'.padStart(10)}${'precision'.padStart(11)}`);
for (const s of r.sweep) out.push(`${s.threshold.toFixed(1).padEnd(12)}${pct(s.coverage).padStart(10)}${pct(s.precision).padStart(11)}`);
out.push('');
out.push(`Promise dates: ${r.dates.promises} promises; exact date ${r.dates.exact}; vague/no-date handled ${r.dates.vagueCorrect}; dates passing validatePromiseDate ${r.dates.validated}`);
out.push('By language (non-English is EXPERIMENTAL until measured separately on real data):');
for (const [lang, m] of Object.entries(r.byLanguage)) out.push(`  ${lang.padEnd(8)}${String(m.items).padStart(4)} items  accuracy ${pct(m.accuracy)}${m.experimental ? '  EXPERIMENTAL' : ''}`);
process.stdout.write(`${out.join('\n')}\n`);

if (values['update-baseline']) {
  const next: Baseline = { recording: path.relative(DATA, path.resolve(DATA, recordingFile)).replace(/\\/g, '/'), macroF1: r.macroF1, recall: Object.fromEntries(Object.entries(r.perIntent).map(([k, v]) => [k, v.recall])) };
  writeFileSync(baselineFile, `${JSON.stringify(next)}\n`);
  process.stdout.write(`\nbaseline updated: ${path.relative(process.cwd(), baselineFile)}\n`);
} else if (!baseline) {
  process.stdout.write('\nno baseline committed: run with --update-baseline\n');
  process.exitCode = 1;
} else {
  const bad = regressions(r, baseline);
  process.stdout.write(bad.length ? `\nREGRESSION versus baseline:\n${bad.map((b) => `  - ${b}`).join('\n')}\n` : `\nno regression versus baseline (macro-F1 ${baseline.macroF1})\n`);
  if (bad.length) process.exitCode = 1;
}
