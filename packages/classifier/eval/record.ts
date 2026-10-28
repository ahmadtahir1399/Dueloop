// pnpm classifier:record — records outputs for every labelled message.
//   --classifier keyword   the deterministic baseline (free, offline; what CI's committed recordings are)
//   --classifier anthropic the real model: needs EVAL_LIVE=1, CLASSIFIER_MODEL and Anthropic credentials.
//                          COSTS MONEY (one request per labelled message). This is `pnpm eval:live`.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { AnthropicReplyClassifier } from '../src/anthropic.ts';
import type { ReplyClassifier } from '../src/classifier.ts';
import { inputHash } from '../src/input.ts';
import { CURRENT_PROMPT_VERSION } from '../src/prompt.ts';
import { DATA, inputFor, labelled, type RecordingLine } from './harness.ts';
import { KeywordBaselineClassifier } from './keyword-baseline.ts';

const { values } = parseArgs({ options: { classifier: { type: 'string', default: 'keyword' } } });
let classifier: ReplyClassifier;
if (values.classifier === 'anthropic') {
  if (process.env.EVAL_LIVE !== '1' || !process.env.CLASSIFIER_MODEL) {
    console.log('eval:live skipped: set EVAL_LIVE=1 and CLASSIFIER_MODEL (e.g. claude-opus-5-5) with Anthropic credentials. It costs money.');
    process.exit(0);
  }
  classifier = new AnthropicReplyClassifier({ model: process.env.CLASSIFIER_MODEL, timeoutMs: 60_000, maxRetries: 2, effort: 'low', fallbacks: true, nowMs: () => performance.now() });
} else {
  classifier = new KeywordBaselineClassifier(CURRENT_PROMPT_VERSION);
}

const lines: RecordingLine[] = [];
let failed = 0;
for (const item of labelled()) {
  const input = inputFor(item);
  const r = await classifier.classify(input);
  if (!r.ok) {
    failed++;
    continue;
  }
  lines.push({ id: item.id, hash: inputHash(input, CURRENT_PROMPT_VERSION), modelId: r.modelId, raw: r.raw });
}
const name = values.classifier === 'anthropic' ? (process.env.CLASSIFIER_MODEL ?? 'model').replace(/[^\w.-]/g, '_') : 'keyword-baseline';
const dir = path.join(DATA, 'recorded', CURRENT_PROMPT_VERSION);
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${name}.jsonl`);
writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
console.log(`recorded ${lines.length} outputs (${failed} failed) -> ${path.relative(process.cwd(), file)}`);
