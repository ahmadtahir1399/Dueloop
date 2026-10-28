// pnpm eval:proof-live: runs the Claude proof extractor on SYNTHETIC images you provide and records the raw
// outputs as JSONL (replayable with RecordedProofExtractor). Never runs in CI; costs money; claims no accuracy.
// Gated: PROOF_EVAL=1, PROOF_EXTRACTION_MODEL (e.g. claude-opus-5-5), Anthropic credentials from the environment
// (or an `ant auth login` profile), and PROOF_EVAL_DIR = a folder of .png/.jpg/.webp files with NO real payer
// data. Only files that pass sniffProof are sent.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AnthropicProofExtractor, parseHints, sniffProof, type ImageMime } from '../src/index.ts';

const env = process.env;
if (env.PROOF_EVAL !== '1') {
  console.log('eval:proof-live skipped: NOT VERIFIED (set PROOF_EVAL=1, PROOF_EXTRACTION_MODEL and PROOF_EVAL_DIR with synthetic images).');
  process.exit(0);
}
const dir = env.PROOF_EVAL_DIR ?? '';
if (!env.PROOF_EXTRACTION_MODEL || !dir) {
  console.error('eval:proof-live: set PROOF_EXTRACTION_MODEL and PROOF_EVAL_DIR');
  process.exit(2);
}
const ex = new AnthropicProofExtractor({ model: env.PROOF_EXTRACTION_MODEL, timeoutMs: 60_000, maxRetries: 2, fallbacks: env.PROOF_EXTRACTION_FALLBACKS !== 'false' });
const lines: string[] = [];
for (const f of readdirSync(dir).filter((n) => /\.(png|jpe?g|webp)$/i.test(n)).sort()) {
  const bytes = readFileSync(path.join(dir, f));
  const s = sniffProof(bytes);
  if (!s.ok || s.mime === 'application/pdf') {
    console.log(JSON.stringify({ file: f, skipped: s.ok ? 'pdf' : s.reason }));
    continue;
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const r = await ex.extract(bytes, s.mime as ImageMime);
  if (!r.ok) {
    console.log(JSON.stringify({ file: f, error: r.error }));
    continue;
  }
  lines.push(JSON.stringify({ sha256, raw: r.raw, modelId: r.modelId }));
  console.log(JSON.stringify({ file: f, modelId: r.modelId, schemaValid: parseHints(r.raw, null) !== null }));
}
const outFile = path.join(dir, `recorded-${ex.promptVersion}.jsonl`);
writeFileSync(outFile, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ recorded: lines.length, file: outFile, accuracy: 'NOT MEASURED' }));
