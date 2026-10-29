// pnpm images:build   build the `services` and `web` images (Dockerfile). Builds against the LOCAL stack unless the
//                     NEXT_PUBLIC_* build values are set in the environment. Never pushes anywhere.
// pnpm images:smoke [--no-build]
//   Against the local stack + Mailpit: compose.selfhost.yml up, /ready on web and webhooks, worker and processor
//   healthy, ONE approved reminder sent end to end by the containerised worker (one email in Mailpit, matching the
//   outbox), image scans (no demo/test code, seed, env files; no secret-looking values in layers or image config),
//   compose down, nothing left behind. Report: .demo/images-smoke.json. Local only.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { scanText } from '../../repo-tools/src/secrets.ts';
import { demoNow } from '../../worker/scripts/demo-clock.ts';
import { pnpmSpawn } from './pnpm-spawn.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEMO = path.join(root, '.demo');
const PROJECT = 'dueloop-smoke';
const WEB = 'http://127.0.0.1:3300';
const HOOKS = 'http://127.0.0.1:8788';
const MAILPIT = 'http://127.0.0.1:54324';
const IMAGES = ['dueloop-services:local', 'dueloop-web:local'] as const;

const sh = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const must = (r: { ok: boolean; out: string; err: string }, what: string) => {
  if (!r.ok) throw new Error(`${what} failed: ${(r.err || r.out).trim().split('\n').slice(-4).join(' | ')}`);
  return r.out;
};
const step = (s: string) => console.log(`\n--- ${s}`);

function localStatus(): Record<string, string> {
  const r = pnpmSpawn(['exec', 'supabase', 'status', '-o', 'json'], { cwd: root, encoding: 'utf8' });
  const out = String(r.stdout ?? '');
  if (r.status !== 0 || !out.includes('{')) throw new Error('the local Supabase stack is not running (pnpm db:start)');
  const s = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  if (!/127\.0\.0\.1|localhost/.test(s.DB_URL ?? '')) throw new Error('refusing: not a local stack');
  return s;
}
/** What containers use to reach the host's local stack (Docker Desktop and the compose host-gateway mapping). */
const viaHost = (url: string) => url.replace(/127\.0\.0\.1|localhost/, 'host.docker.internal');

function build(s: Record<string, string>) {
  const args = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? viaHost(s.API_URL ?? ''),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? s.PUBLISHABLE_KEY ?? s.ANON_KEY ?? '',
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300',
  };
  const t0 = performance.now();
  must(sh('docker', ['build', '--target', 'services', '-t', IMAGES[0], '.']), 'docker build services');
  must(sh('docker', ['build', '--target', 'web', '-t', IMAGES[1], ...Object.entries(args).flatMap(([k, v]) => ['--build-arg', `${k}=${v}`]), '.']), 'docker build web');
  return Math.round((performance.now() - t0) / 1000);
}

async function until(what: string, ms: number, check: () => Promise<boolean>) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000)); // polling observable state, not a fixed sleep
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** File list and content markers that must never be in an image (rule 41). */
function scanImage(image: string): string[] {
  const findings: string[] = [];
  const files = must(sh('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', 'find /app -path "*/node_modules" -prune -o -type f -print']), `list ${image}`).split('\n').filter(Boolean);
  const forbidden = [/\/scripts\/(?!local-env\.ts$)/, /seed\.sql$/, /\/e2e\//, /\/(test|test-db|test-load|test-adversarial|fixtures|eval)\//, /\/demo-[^/]*$/, /(^|\/)\.env(\.|$)/, /\.pem$/, /playwright\.config/];
  for (const f of files) for (const re of forbidden) if (re.test(f)) findings.push(`${image}: file ${f}`);
  // DEMO_MODE as a NAME is fine (the env schema documents it); code that READS it must not ship.
  const markers = String.raw`process\.env\.DEMO_MODE|e2e-demo-steps|demo-clock|local-e2e-only|KeywordBaselineClassifier|__pwned|demo\.owner@|fpay_demo_`;
  const grep = sh('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', `grep -rlE '${markers}' /app --exclude-dir=node_modules || true`]);
  for (const f of grep.out.split('\n').filter(Boolean)) findings.push(`${image}: marker in ${f}`);
  // Secrets in layer commands or the image config (env, labels).
  const meta = `${sh('docker', ['history', '--no-trunc', '--format', '{{.CreatedBy}}', image]).out}\n${sh('docker', ['image', 'inspect', image]).out}`;
  for (const f of scanText(meta, `${image}:metadata`)) findings.push(`${image}: ${f.rule} in layer history/config`);
  return findings;
}

async function smoke(noBuild: boolean) {
  const t0 = performance.now();
  const s = localStatus();
  const report: Record<string, unknown> = {};
  mkdirSync(DEMO, { recursive: true });

  step('1/7 build images');
  report.build_seconds = noBuild ? 'skipped (--no-build)' : build(s);

  step('2/7 runtime env file (.demo/selfhost.env, local values only) and a fresh seed');
  const db = viaHost(s.DB_URL ?? '');
  const envFile = path.join(DEMO, 'selfhost.env');
  writeFileSync(
    envFile,
    [
      `WORKER_DATABASE_URL=${db}`,
      `SUPABASE_DB_URL=${db}`,
      `SUPABASE_URL=${viaHost(s.API_URL ?? '')}`,
      `SUPABASE_SERVICE_ROLE_KEY=${s.SERVICE_ROLE_KEY ?? ''}`,
      `NEXT_PUBLIC_SUPABASE_URL=${viaHost(s.API_URL ?? '')}`,
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${s.PUBLISHABLE_KEY ?? s.ANON_KEY ?? ''}`,
      'PUBLIC_APP_URL=http://localhost:3300',
      'SMTP_HOST=host.docker.internal',
      'SMTP_PORT=54325',
      'SMTP_SECURE=false',
      'PAYMENTS_WEBHOOKS=true',
      '',
    ].join('\n'),
  );
  must(pnpmSpawn(['exec', 'supabase', 'db', 'reset'], { cwd: root, encoding: 'utf8' }).status === 0 ? { ok: true, out: '', err: '' } : { ok: false, out: '', err: 'db reset' }, 'db reset');
  const composeEnv = { DUELOOP_ENV_FILE: envFile, NEXT_PUBLIC_SUPABASE_URL: viaHost(s.API_URL ?? ''), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: s.PUBLISHABLE_KEY ?? '', NEXT_PUBLIC_APP_URL: 'http://localhost:3300' };
  const compose = (...a: string[]) => sh('docker', ['compose', '-f', 'compose.selfhost.yml', '-p', PROJECT, ...a], composeEnv);

  const pool = new pg.Pool({ connectionString: s.DB_URL, max: 2 });
  try {
    step('3/7 compose up (no build: the images from step 1)');
    must(compose('up', '-d', '--no-build'), 'compose up');
    const t1 = performance.now();
    await until('web /ready', 180_000, async () => (await fetch(`${WEB}/ready`)).ok);
    await until('webhooks /ready', 120_000, async () => (await fetch(`${HOOKS}/ready`)).ok);
    for (const svc of ['worker', 'processor', 'webhooks', 'web'])
      await until(`${svc} healthy`, 240_000, async () => {
        const id = compose('ps', '-q', svc).out.trim();
        return id !== '' && sh('docker', ['inspect', '--format', '{{.State.Health.Status}}', id]).out.trim() === 'healthy';
      });
    report.ready_seconds = Math.round((performance.now() - t1) / 1000);

    step('4/7 one reminder end to end through the containerised worker (approval-always tenant)');
    await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
    const now = demoNow().toISO() ?? '';
    const run = (...cmd: string[]) => must(compose('run', '--rm', '--no-deps', 'worker', 'node', ...cmd), cmd.join(' '));
    run('packages/worker/src/bin/worker.ts', '--once', '--now', now);
    const pending = (await pool.query<{ n: number }>(`select count(*)::int as n from public.approvals a join public.tenants t on t.id = a.tenant_id where t.name = 'Demo Agency' and a.status = 'pending'`)).rows[0]?.n ?? 0;
    if (pending === 0) throw new Error('the worker proposed no reminders for Demo Agency');
    run('packages/worker/src/bin/approvals.ts', 'approve', '--all-pending', '--tenant', 'Demo Agency');
    run('packages/worker/src/bin/worker.ts', '--once', '--now', now);
    // The long-running worker container may claim the approved jobs before this one-off pass does; either way the
    // outbox and Mailpit must agree: one email per approved reminder, none twice. Re-read both until they settle.
    let sent = 0;
    let mails = 0;
    await until(`one email per sent reminder (last seen: ${sent} sent, ${mails} emails)`, 120_000, async () => {
      sent = (await pool.query<{ n: number }>(`select count(*)::int as n from public.messages m join public.tenants t on t.id = m.tenant_id where t.name = 'Demo Agency' and m.direction = 'out' and m.send_state = 'sent'`)).rows[0]?.n ?? 0;
      mails = ((await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as { total: number }).total;
      return sent === pending && mails === sent;
    });
    report.reminder = { approvals: pending, sent, emails_in_mailpit: mails };
  } finally {
    step('5/7 compose down');
    compose('down', '--volumes', '--remove-orphans');
    await pool.end();
  }

  step('6/7 nothing left behind');
  const left = sh('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project=${PROJECT}`, '-q']).out.trim();
  report.leftover_containers = left ? left.split('\n').length : 0;

  step('7/7 image scans (files, markers, layer history, config)');
  const findings = IMAGES.flatMap(scanImage);
  report.image_scan_findings = findings;
  report.image_sizes = Object.fromEntries(IMAGES.map((i) => [i, sh('docker', ['image', 'inspect', '--format', '{{.Size}}', i]).out.trim()]));
  report.user = Object.fromEntries(IMAGES.map((i) => [i, sh('docker', ['image', 'inspect', '--format', '{{.Config.User}}', i]).out.trim()]));
  report.seconds = Math.round((performance.now() - t0) / 1000);
  writeFileSync(path.join(DEMO, 'images-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.leftover_containers === 0 && findings.length === 0 ? 0 : 1;
}

const [cmd] = process.argv.slice(2);
try {
  if (cmd === 'build') console.log(`built ${IMAGES.join(', ')} in ${build(localStatus())} s`);
  else if (cmd === 'smoke') await smoke(process.argv.includes('--no-build'));
  else {
    console.error('usage: images.ts build | smoke [--no-build]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, '[db-url]') : 'failed');
  process.exitCode = 1;
}
