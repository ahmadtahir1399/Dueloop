// pnpm demo [--non-interactive] [--rebuild]  preflight, safety, start everything, print URLs + logins + the guide
// pnpm demo:stop                             stop everything `pnpm demo` started; assert nothing is left
// pnpm demo:reset                            back to the initial seeded state (new logins, empty mail catcher)
// pnpm demo:logs [name]                      the last lines of each demo process log (.demo/logs/)
// Local only: refuses non-local URLs and live-looking keys (safety.ts). Writes only under .demo/ (gitignored).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { alive, clearState, DEMO_DIR, demoEnv, DemoError, fail, LOGS, PORTS, portFree, readState, root, stackStatus, startProcess, stopProcess, supabase, until, URLS, writeState, type DemoState } from '../runtime.ts';
import { safetyProblems } from '../safety.ts';
import { setupDemoData, type SetupResult } from '../setup.ts';

/**
 * Minimums derived from a measured run (docs/measurements/demo-resources.txt): about 1.0 GB of memory in use (node
 * processes 0.42 GB + containers 0.59 GB) -> 4 GB total RAM leaves room for the OS, Docker's VM and the web build;
 * about 4.5 GB of disk (Supabase images 3.6 GB, node_modules 0.8 GB, web build 0.12 GB) -> 6 GB free.
 */
export const MIN_FREE_DISK_GB = 6;
export const MIN_TOTAL_RAM_GB = 4;
const SUPABASE_PORTS = [54321, 54322, 54324, 54325, 54327];

const [cmd = 'start'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (f: string) => process.argv.includes(f);
const t = () => performance.now();
const secs = (from: number) => Math.round((performance.now() - from) / 100) / 10;

function check(name: string, ok: boolean, why: string, fix: string, problems: string[]) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) problems.push(`${name}: ${why}\n      fix: ${fix}`);
}

async function preflight(): Promise<boolean> {
  console.log('Preflight');
  const problems: string[] = [];
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { engines: { node: string }; packageManager: string };
  const need = pkg.engines.node.replace(/^>=/, '').split('.').map(Number);
  const have = process.versions.node.split('.').map(Number);
  const nodeOk = (have[0] ?? 0) > (need[0] ?? 0) || ((have[0] ?? 0) === (need[0] ?? 0) && ((have[1] ?? 0) > (need[1] ?? 0) || ((have[1] ?? 0) === (need[1] ?? 0) && (have[2] ?? 0) >= (need[2] ?? 0))));
  check(`Node ${process.versions.node} (needs ${pkg.engines.node})`, nodeOk, 'Node is older than package.json "engines"', 'install the version in .nvmrc (e.g. `nvm install`)', problems);
  const pnpmWant = pkg.packageManager.split('@')[1] ?? '';
  const pnpmHave = /pnpm\/([\d.]+)/.exec(process.env.npm_config_user_agent ?? '')?.[1] ?? 'unknown';
  check(`pnpm ${pnpmHave} (needs ${pnpmWant})`, pnpmHave === pnpmWant, 'a different pnpm than package.json "packageManager"', '`corepack enable` and run through pnpm again', problems);
  const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  check(`Docker reachable${docker.status === 0 ? ` (Engine ${docker.stdout.trim()})` : ''}`, docker.status === 0, 'the Docker daemon is not running or not installed', 'start Docker Desktop (or the docker service) and retry', problems);
  const stackUp = stackStatus() !== null;
  const ports = [PORTS.web, PORTS.webhooks, ...(stackUp ? [] : SUPABASE_PORTS)];
  for (const p of ports) check(`port ${p} free`, await portFree(p), 'another program listens on it', p === PORTS.web ? 'stop it, or set DEMO_WEB_PORT' : p === PORTS.webhooks ? 'stop it, or set DEMO_WEBHOOKS_PORT' : 'stop the other Supabase project (`pnpm exec supabase stop --all`) or the program on that port', problems);
  const fs = statfsSync(root);
  const freeGb = Math.round(((fs.bavail * fs.bsize) / 1024 ** 3) * 10) / 10;
  check(`free disk ${freeGb} GB (needs ${MIN_FREE_DISK_GB})`, freeGb >= MIN_FREE_DISK_GB, 'not enough space for the Supabase images and the build', 'free disk space (docker system prune removes unused images)', problems);
  const ramGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
  check(`memory ${ramGb} GB (needs ${MIN_TOTAL_RAM_GB})`, ramGb >= MIN_TOTAL_RAM_GB, 'too little RAM for the Supabase stack plus the services', 'close other programs or use a larger machine; give Docker Desktop more memory', problems);
  if (!stackUp && docker.status === 0) {
    const images = spawnSync('docker', ['image', 'ls', '--format', '{{.Repository}}'], { encoding: 'utf8' }).stdout;
    if (!/supabase\//.test(images)) {
      const net = await fetch('https://public.ecr.aws/', { method: 'HEAD', signal: AbortSignal.timeout(5000) }).then(() => true, () => false);
      check('network for the first image download', net, 'no Supabase images are cached and the registry is unreachable', 'connect to the internet for the first run (several GB of images)', problems);
    }
  }
  const unsafe = safetyProblems(process.env);
  check('environment is local and has no live keys', unsafe.length === 0, unsafe.join('; '), 'unset the variables named above for the demo shell', problems);
  if (problems.length) console.error(`\nPreflight failed:\n  - ${problems.join('\n  - ')}`);
  return problems.length === 0;
}

function printLogins(r: SetupResult) {
  console.log('\nDemo logins (random for this run; shown ONCE, never stored):');
  console.table(r.logins.map((l) => ({ role: l.role, email: l.email, password: l.password })));
}

async function start() {
  const timings: Record<string, number> = {};
  const all = t();
  const prev = readState();
  if (prev && Object.values(prev.pids).every(alive)) {
    console.log(`The demo is already running (started ${prev.startedAt}). Web: ${URLS.web}\nUse \`pnpm demo:reset\` for a fresh state (new logins) or \`pnpm demo:stop\`.`);
    return;
  }
  if (prev) await stop(true); // a half-dead previous run: clean it up first (idempotent re-run)
  let p = t();
  if (!(await preflight())) process.exit(1);
  timings.preflight = secs(p);

  p = t();
  let status = stackStatus();
  const startedStack = status === null;
  if (startedStack) {
    console.log('\nStarting the local Supabase stack (first run downloads images)...');
    supabase(['start'], false);
    status = stackStatus() ?? fail('the Supabase stack did not come up');
  }
  timings.supabase_start = secs(p);
  const env = demoEnv(status as Record<string, string>);

  p = t();
  console.log('Applying migrations + the demo seed (supabase db reset)...');
  supabase(['db', 'reset']);
  const data = await setupDemoData(env);
  timings.reset_and_seed = secs(p);

  p = t();
  const buildInfo = path.join(DEMO_DIR, 'build.json');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const built = existsSync(buildInfo) && (JSON.parse(readFileSync(buildInfo, 'utf8')) as { head: string }).head === head && existsSync(path.join(root, 'apps/web/.next-demo/BUILD_ID'));
  const nextBin = path.join(root, 'apps/web/node_modules/next/dist/bin/next');
  if (!built || flag('--rebuild')) {
    console.log('Building the web app (production build, local values inlined)...');
    const b = spawnSync(process.execPath, [nextBin, 'build'], { cwd: path.join(root, 'apps/web'), env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (b.status !== 0) fail(`web build failed:\n${(b.stdout + b.stderr).split('\n').slice(-15).join('\n')}`);
    writeFileSync(buildInfo, JSON.stringify({ head }));
  }
  timings.web_build = secs(p);

  p = t();
  const pids: Record<string, number> = {
    web: startProcess('web', [nextBin, 'start', '-p', String(PORTS.web)], env, path.join(root, 'apps/web')),
    ...startServices(env),
  };
  const state: DemoState = { mode: 'demo', startedAt: new Date().toISOString(), startedStack, pids, tenantId: data.tenantId, payment: data.payment, timings };
  writeState(state);
  await until('web /ready', 120_000, async () => (await fetch(`${URLS.web}/ready`)).ok);
  await until('webhooks /ready', 60_000, async () => (await fetch(`${URLS.webhooks}/ready`)).ok);
  const pool = new pg.Pool({ connectionString: env.WORKER_DATABASE_URL, max: 1 });
  try {
    for (const svc of ['worker', 'processor'])
      await until(`${svc} heartbeat`, 90_000, async () => ((await pool.query<{ n: number }>(`select count(*)::int as n from private.service_heartbeats where service = $1 and last_seen_at > now() - interval '2 minutes'`, [svc])).rows[0]?.n ?? 0) > 0);
  } finally {
    await pool.end();
  }
  timings.services_ready = secs(p);
  timings.total = secs(all);
  writeState({ ...state, timings });
  writeFileSync(path.join(DEMO_DIR, 'timings.json'), `${JSON.stringify({ at: new Date().toISOString(), stack_was_running: !startedStack, timings }, null, 2)}\n`);

  console.log(`\nThe demo is running (${timings.total} s).`);
  console.table([
    { what: 'Dashboard', url: `${URLS.web}/login` },
    { what: 'Mail catcher (every email the demo sends)', url: URLS.mailpit },
    { what: 'Webhooks service', url: `${URLS.webhooks}/ready` },
  ]);
  printLogins(data);
  console.log('\nGuided script: docs/demo-script.md. Drive it with:');
  for (const c of ['pnpm demo:control run-cycle', 'pnpm demo:control inbound promise|vague|paid-claim|dispute|stop [--invoice DA-0001]', 'pnpm demo:control pay <invoice number>', 'pnpm demo:control status', 'pnpm demo:reset', 'pnpm demo:logs', 'pnpm demo:stop'])
    console.log(`  ${c}`);
  if (!flag('--non-interactive')) console.log('\n(Everything keeps running in the background. Stop it with `pnpm demo:stop`.)');
}

/** The services that hold database connections: they exit when a reset drops the database, so reset restarts them. */
const DB_SERVICES = ['webhooks', 'worker', 'processor'] as const;
function startServices(env: NodeJS.ProcessEnv): Record<string, number> {
  return {
    webhooks: startProcess('webhooks', ['packages/webhooks/src/bin/webhooks.ts'], { ...env, PORT: String(PORTS.webhooks) }),
    worker: startProcess('worker', ['packages/worker/src/bin/worker.ts', '--loop', '--interval', '30'], env),
    processor: startProcess('processor', ['packages/demo/src/bin/processor.ts'], env),
  };
}

async function stop(quiet = false) {
  const s = readState();
  if (!s) {
    if (!quiet) console.log('No demo is running (no .demo/state.json).');
    return;
  }
  for (const [name, pid] of Object.entries(s.pids)) {
    stopProcess(pid);
    if (!quiet) console.log(`  stopped ${name}`);
  }
  await until('demo processes to exit', 30_000, () => Object.values(s.pids).every((pid) => !alive(pid)));
  if (s.startedStack) {
    if (!quiet) console.log('  stopping the Supabase stack the demo started');
    supabase(['stop']);
  }
  clearState();
  const busy: number[] = [];
  for (const p of [PORTS.web, PORTS.webhooks]) if (!(await portFree(p))) busy.push(p);
  if (busy.length) fail(`ports still in use after stop: ${busy.join(', ')}`);
  if (!quiet) console.log(`Stopped. No demo process is left; ports ${PORTS.web} and ${PORTS.webhooks} are free.${s.startedStack ? ' The Supabase stack is stopped.' : ' The Supabase stack was already running before the demo and is left running.'}`);
}

async function reset() {
  const s = readState() ?? fail('no demo is running: start it with `pnpm demo`');
  const env = demoEnv(stackStatus() ?? fail('the Supabase stack is not running'));
  console.log('Resetting to the seeded state (supabase db reset) ...');
  for (const name of DB_SERVICES) if (s.pids[name]) stopProcess(s.pids[name]);
  await until('the database services to stop', 30_000, () => DB_SERVICES.every((n) => !s.pids[n] || !alive(s.pids[n] as number)));
  supabase(['db', 'reset']);
  const data = await setupDemoData(env);
  writeState({ ...s, tenantId: data.tenantId, payment: data.payment, pids: { ...s.pids, ...startServices(env) } });
  await until('webhooks /ready', 60_000, async () => (await fetch(`${URLS.webhooks}/ready`)).ok);
  console.log('Done. Sign in again with the NEW logins.');
  printLogins(data);
}

function logs() {
  const only = process.argv.slice(3).find((a) => !a.startsWith('--'));
  if (!existsSync(LOGS)) return console.log('No demo logs yet.');
  for (const f of readdirSync(LOGS).filter((x) => !only || x.startsWith(only))) {
    console.log(`\n===== ${f}`);
    console.log(readFileSync(path.join(LOGS, f), 'utf8').split('\n').slice(-40).join('\n'));
  }
}

try {
  if (cmd === 'start') await start();
  else if (cmd === 'stop') await stop();
  else if (cmd === 'reset') await reset();
  else if (cmd === 'logs') logs();
  else {
    console.error('usage: demo.ts start [--non-interactive] [--rebuild] | stop | reset | logs [name]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof DemoError ? e.message : e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, '[db-url]') : 'failed');
  process.exitCode = 1;
}
