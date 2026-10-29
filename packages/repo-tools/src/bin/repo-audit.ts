// pnpm repo:audit [--skip-history]: secrets (tree + full history, with a planted-secret proof), large files,
// env-example parity, claims audit, licence presence per decision, fixture PII, script portability.
// Prints a table and findings (never secret values: rule, place and a short fingerprint). Exit 1 on any failure.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimFindings, licenceFindings, piiFindings, scriptFindings, type Finding } from '../checks.ts';
import { scanHistory, scanText, scanTree, treeFiles } from '../secrets.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const LARGE_BYTES = 1024 * 1024;
/** Tracked binaries are allowed only here (none today); everything else must be text or generated at test time. */
const BINARY_ALLOW: ReadonlySet<string> = new Set([]);
/** User-facing documents where claims are audited (ADRs and reports are engineering records, not sales material). */
const CLAIM_DOCS = (files: string[]) => files.filter((f) => /^(README|SECURITY|CONTRIBUTING|CHANGELOG)\.md$/.test(f) || /^docs\/[^/]+\.md$/.test(f));

const results: { check: string; ok: boolean; findings: Finding[]; note?: string | undefined }[] = [];
const run = (check: string, fn: () => Finding[] | { findings: Finding[]; note: string }) => {
  try {
    const r = fn();
    const findings = Array.isArray(r) ? r : r.findings;
    results.push({ check, ok: findings.length === 0, findings, note: Array.isArray(r) ? undefined : r.note });
  } catch (e) {
    results.push({ check, ok: false, findings: [{ where: '-', detail: e instanceof Error ? e.message : 'failed' }] });
  }
};

const files = treeFiles(root);
const isBinary = (f: string) => readFileSync(path.join(root, f)).subarray(0, 8000).includes(0);

run('secrets: working tree', () => scanTree(root).map((f) => ({ where: f.where, detail: `${f.rule} ${f.fingerprint}` })));

run('secrets: scanner proven on a planted secret', () => {
  // A throwaway repo in the OS temp dir: add a fake live key, delete it, and require the HISTORY scan to find it
  // while the TREE scan does not. This repository's history is never touched.
  const dir = mkdtempSync(path.join(tmpdir(), 'dueloop-planted-'));
  try {
    const g = (...a: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=audit', '-c', 'user.email=audit@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`planted repo: git ${a[0]} failed`);
    };
    g('init', '-q');
    const fake = ['sk', 'live', 'PLANTEDfake0000000000000000'].join('_');
    writeFileSync(path.join(dir, 'config.ts'), `export const key = '${fake}';\n`);
    g('add', '.');
    g('commit', '-q', '-m', 'plant');
    writeFileSync(path.join(dir, 'config.ts'), 'export const key = readKeyFromVault();\n');
    g('commit', '-q', '-am', 'remove');
    const inHistory = scanHistory(dir).some((f) => f.rule === 'stripe-secret-key');
    const inTree = scanTree(dir).length > 0;
    return inHistory && !inTree ? { findings: [], note: 'history scan found the deleted key; tree scan correctly did not' } : [{ where: dir, detail: `planted key: history=${inHistory} tree=${inTree}` }];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

if (process.argv.includes('--skip-history')) results.push({ check: 'secrets: full git history', ok: true, findings: [], note: 'SKIPPED (--skip-history)' });
else
  run('secrets: full git history', () => {
    const commits = spawnSync('git', ['rev-list', '--all', '--count'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    return { findings: scanHistory(root).map((f) => ({ where: f.where, detail: `${f.rule} ${f.fingerprint} (LEAKED: rotate, rule 46)` })), note: `${commits} commits, all refs` };
  });

run('large and binary files', () =>
  files.flatMap((f) => {
    const out: Finding[] = [];
    const size = statSync(path.join(root, f)).size;
    if (size > LARGE_BYTES) out.push({ where: f, detail: `${size} bytes > ${LARGE_BYTES}` });
    if (isBinary(f) && !BINARY_ALLOW.has(f)) out.push({ where: f, detail: 'binary file committed' });
    return out;
  }),
);

run('env: .env.example matches the schema', () => {
  const r = spawnSync(process.execPath, ['packages/config/scripts/env-example.ts', '--check'], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? [] : [{ where: '.env.example', detail: r.stderr.trim() || 'stale' }];
});

run('env: no .env file is tracked', () => files.filter((f) => /(^|\/)\.env($|\.(?!example$))/.test(f)).map((f) => ({ where: f, detail: 'env file in the tree' })));

run('fixture PII: synthetic contact data only', () => files.filter((f) => !isBinary(f) && f !== 'pnpm-lock.yaml').flatMap((f) => piiFindings(readFileSync(path.join(root, f), 'utf8'), f)));

run('claims audit (README, SECURITY, docs/*.md)', () => CLAIM_DOCS(files).flatMap((f) => claimFindings(readFileSync(path.join(root, f), 'utf8'), f, root)));

run('licence presence per decision', () => licenceFindings(root));

run('script portability (package.json)', () =>
  files
    .filter((f) => f === 'package.json' || /^(packages|apps)\/[^/]+\/package\.json$/.test(f))
    .flatMap((f) => scriptFindings(f, (JSON.parse(readFileSync(path.join(root, f), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {})),
);

// Self-check: the patterns must fire on hostile input (guards against a regex that silently matches nothing).
run('secrets: patterns fire on known shapes', () => {
  const shapes = [['sk', 'test', 'aaaaaaaaaaaaaaaaaaaa'].join('_'), `-----BEGIN ${'PRIVATE'} KEY-----`, `AKIA${'A'.repeat(16)}`, `xoxb-${'1'.repeat(12)}`];
  return shapes.filter((s) => scanText(s, 'probe').length === 0).map((s) => ({ where: 'probe', detail: `no rule fired for ${s.slice(0, 6)}…` }));
});

const width = Math.max(...results.map((r) => r.check.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.check.padEnd(width)}  ${r.ok ? (r.note ?? '') : `${r.findings.length} finding(s)`}`);
for (const r of results.filter((x) => !x.ok)) {
  console.log(`\n${r.check}:`);
  for (const f of r.findings.slice(0, 50)) console.log(`  ${f.where}  ${f.detail}`);
  if (r.findings.length > 50) console.log(`  … ${r.findings.length - 50} more`);
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
