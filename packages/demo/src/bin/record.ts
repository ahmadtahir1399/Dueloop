// pnpm demo:record: the automated 7-step demo (apps/web e2e/demo) recorded as video, with synthetic data only, into
// .demo/recording/ (gitignored; never committed). Then the leak check (issue O): every page DOM the video showed is
// scanned for secret-looking strings and for contact data outside the reserved test domains and fictional ranges.
// A clean scan is necessary, not sufficient: a person must still watch the final video before it is shared, and
// narration and editing are the owner's work.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { piiFindings } from '../../../repo-tools/src/checks.ts';
import { scanText } from '../../../repo-tools/src/secrets.ts';
import { pnpmSpawn } from '../../../ops/scripts/pnpm-spawn.ts';
import { DEMO_DIR, root, stackStatus } from '../runtime.ts';
import { safetyProblems } from '../safety.ts';

const OUT = path.join(DEMO_DIR, 'recording');
const DOM = path.join(OUT, 'dom');

function walk(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)])) : [];
}

const unsafe = safetyProblems(process.env);
if (unsafe.length || !stackStatus()) {
  console.error(unsafe.length ? `refusing: ${unsafe.join('; ')}` : 'the local Supabase stack is not running (pnpm db:start)');
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
console.log('Recording the 7-step demo (synthetic data, local stack)...');
pnpmSpawn(['exec', 'supabase', 'db', 'reset'], { cwd: root, stdio: 'ignore' });
const run = pnpmSpawn(['--filter', '@dueloop/web', 'exec', 'playwright', 'test', '--project', 'demo', '--output', path.join(OUT, 'artifacts')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DEMO_RECORD: '1', DEMO_RECORD_DOM: DOM },
});
const videos = walk(OUT).filter((f) => f.endsWith('.webm'));
const pages = walk(DOM).filter((f) => f.endsWith('.html'));
const findings: string[] = [];
for (const f of pages) {
  const text = readFileSync(f, 'utf8');
  for (const s of scanText(text, path.basename(f))) findings.push(`${s.where}: ${s.rule} ${s.fingerprint}`);
  for (const p of piiFindings(text, path.basename(f))) findings.push(`${p.where}: ${p.detail}`);
}
const report = { demo_passed: run.status === 0, videos: videos.map((v) => path.relative(root, v)), pages_scanned: pages.length, leak_findings: findings, human_review: 'REQUIRED before sharing: watch the whole video' };
writeFileSync(path.join(OUT, 'leak-check.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = run.status === 0 && videos.length > 0 && pages.length > 0 && findings.length === 0 ? 0 : 1;
