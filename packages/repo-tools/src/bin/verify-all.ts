// pnpm verify:all [--from <step>] [--only a,b] [--list]: EVERY suite from prompts 1-7, in order, against the local
// stack. Stops at the first failure and exits non-zero; prints a step / result / seconds table and writes it to
// .reports/verify-all.json. Steps that need a fresh database reset it first (they are listed with "reset").
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pnpmSpawn } from '../../../ops/scripts/pnpm-spawn.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

interface Step {
  name: string;
  /** pnpm arguments; one array per command, run in order. */
  run: string[][];
  /** `supabase db reset` first (the suite expects the seed as shipped). */
  reset?: boolean;
}

const IMPORT_ARGS = ['--tenant', '5eed0000-0000-4000-8000-00000000000a', '--file', 'packages/ingest/fixtures/messy-eu.csv', '--mapping', 'packages/ingest/fixtures/mappings/eu.json', '--options', 'packages/ingest/fixtures/options/de-dmy.json', '--skip-invalid'];
const SIM = ['--silent', 'sim', '--days', '90', '--invoices', '500', '--seed', '42'];

export const STEPS: readonly Step[] = [
  { name: 'lint', run: [['lint']] },
  { name: 'typecheck', run: [['typecheck']] },
  { name: 'unit tests', run: [['test']] },
  { name: 'env schema vs .env.example', run: [['env:check']] },
  { name: 'repo audit', run: [['repo:audit']] },
  { name: 'docs check', run: [['docs:check']] },
  { name: 'egress check', run: [['egress:check']] },
  { name: 'simulator (deterministic, no violations)', run: [SIM] },
  { name: 'database tests (pgTAP + integration + chaos)', run: [['db:test']], reset: true },
  { name: 'RLS check', run: [['db:rls-check']] },
  { name: 'generated types are current', run: [['db:types:check']] },
  { name: 'doctor + ops status', run: [['doctor'], ['ops:status']] },
  { name: 'import dry run, then twice', run: [['run', 'import', ...IMPORT_ARGS, '--dry-run'], ['import:twice', ...IMPORT_ARGS]], reset: true },
  { name: 'adversarial suite', run: [['test:adversarial']] },
  { name: 'load test', run: [['test:load']] },
  { name: 'classifier evaluation', run: [['classifier:eval']] },
  { name: 'demo: send', run: [['demo:send']], reset: true },
  { name: 'demo: replies', run: [['demo:replies']], reset: true },
  { name: 'demo: payments', run: [['demo:payments']], reset: true },
  { name: 'payments integrity', run: [['payments:integrity']] },
  { name: 'backup drill', run: [['backup:drill']] },
  { name: 'web build', run: [['web:build']] },
  { name: 'web e2e (staff)', run: [['web:test:e2e']] },
  { name: 'web security', run: [['web:test:security']] },
  { name: 'web accessibility', run: [['web:test:a11y']] },
  { name: 'web low bandwidth', run: [['web:test:lowbandwidth']] },
  { name: 'e2e demo (7 steps)', run: [['e2e:demo']] },
  { name: 'perf pages (50k invoices)', run: [['perf:pages']] },
  { name: 'container images: build + smoke', run: [['images:smoke']] },
  { name: 'demo contract: start, seven steps, stop', run: [['demo', '--non-interactive'], ['demo:selftest'], ['demo:stop']] },
];

const pnpm = (args: string[], env: NodeJS.ProcessEnv) => pnpmSpawn(args, { cwd: root, env, stdio: 'inherit' });

function localEnv(): NodeJS.ProcessEnv {
  const r = pnpmSpawn(['exec', 'supabase', 'status', '-o', 'json'], { cwd: root, encoding: 'utf8' });
  try {
    const out = String(r.stdout ?? '');
    const s = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
    return { ...process.env, SUPABASE_URL: s.API_URL, SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY, WORKER_DATABASE_URL: s.DB_URL };
  } catch {
    return process.env;
  }
}

function main() {
  const arg = (n: string) => {
    const i = process.argv.indexOf(n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  if (process.argv.includes('--list')) {
    STEPS.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${s.name}${s.reset ? '  (reset)' : ''}`));
    return;
  }
  const only = arg('--only')?.split(',');
  const from = arg('--from');
  let steps = only ? STEPS.filter((s) => only.includes(s.name)) : STEPS;
  if (from) steps = steps.slice(Math.max(0, steps.findIndex((s) => s.name === from)));
  const rows: { step: string; result: string; seconds: number }[] = [];
  for (const s of steps) {
    console.log(`\n=== verify:all > ${s.name}`);
    const t0 = performance.now();
    let ok = true;
    if (s.reset) ok = pnpm(['exec', 'supabase', 'db', 'reset'], process.env).status === 0;
    const env = localEnv();
    for (const cmd of s.run) {
      if (!ok) break;
      if (cmd === SIM) {
        // Deterministic: the same seed twice gives byte-identical output.
        const a = pnpmSpawn(SIM, { cwd: root, encoding: 'utf8' });
        const b = pnpmSpawn(SIM, { cwd: root, encoding: 'utf8' });
        ok = a.status === 0 && b.status === 0 && String(a.stdout) === String(b.stdout);
        process.stdout.write(String(a.stdout).split('\n').slice(-6).join('\n'));
      } else ok = pnpm(cmd, env).status === 0;
    }
    rows.push({ step: s.name, result: ok ? 'PASS' : 'FAIL', seconds: Math.round((performance.now() - t0) / 100) / 10 });
    if (!ok) break;
  }
  const skipped = steps.slice(rows.length).map((s) => ({ step: s.name, result: 'NOT RUN', seconds: 0 }));
  console.log('\nverify:all summary');
  console.table([...rows, ...skipped]);
  mkdirSync(path.join(root, '.reports'), { recursive: true });
  writeFileSync(path.join(root, '.reports/verify-all.json'), `${JSON.stringify({ finished_at: new Date().toISOString(), steps: [...rows, ...skipped] }, null, 2)}\n`);
  process.exitCode = rows.every((r) => r.result === 'PASS') && skipped.length === 0 ? 0 : 1;
}

main();
