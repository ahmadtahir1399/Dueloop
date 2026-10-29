// Shared plumbing for `pnpm demo*`: the .demo/ directory (the ONLY place the demo writes), the local stack's values,
// the process table, and cross-platform start/stop. Demo code: excluded from every image (.dockerignore).
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pnpmSpawn } from '../../ops/scripts/pnpm-spawn.ts';
import { safetyProblems } from './safety.ts';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEMO_DIR = path.join(root, '.demo');
export const LOGS = path.join(DEMO_DIR, 'logs');
const STATE = path.join(DEMO_DIR, 'state.json');
export const TENANT = 'Demo Agency';
export const PORTS = { web: Number(process.env.DEMO_WEB_PORT ?? 3000), webhooks: Number(process.env.DEMO_WEBHOOKS_PORT ?? 8787) };
export const URLS = { web: `http://localhost:${PORTS.web}`, webhooks: `http://127.0.0.1:${PORTS.webhooks}`, mailpit: 'http://127.0.0.1:54324', api: 'http://127.0.0.1:54321' };

export interface DemoState {
  mode: 'demo';
  startedAt: string;
  startedStack: boolean;
  pids: Record<string, number>;
  tenantId: string;
  /** The demo's FakeGateway test account (local only): its webhook URL token and signing secret. */
  payment: { token: string; secret: string };
  timings: Record<string, number>;
}

export const readState = (): DemoState | null => (existsSync(STATE) ? (JSON.parse(readFileSync(STATE, 'utf8')) as DemoState) : null);
export const writeState = (s: DemoState) => {
  mkdirSync(DEMO_DIR, { recursive: true });
  writeFileSync(STATE, `${JSON.stringify(s, null, 2)}\n`);
};
export const clearState = () => rmSync(STATE, { force: true });

export class DemoError extends Error {}
export const fail = (msg: string): never => {
  throw new DemoError(msg);
};

/** `supabase status` of THIS project, or null when the stack is not running. */
export function stackStatus(): Record<string, string> | null {
  const r = pnpmSpawn(['exec', 'supabase', 'status', '-o', 'json'], { cwd: root, encoding: 'utf8' });
  const out = String(r.stdout ?? '');
  if (r.status !== 0 || !out.includes('"DB_URL"')) return null;
  return JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
}

export function supabase(args: string[], quiet = true) {
  const r = pnpmSpawn(['exec', 'supabase', ...args], { cwd: root, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
  if (r.status !== 0) fail(`supabase ${args.join(' ')} failed: ${String(r.stderr ?? '').trim().split('\n').slice(-2).join(' | ')}`);
}

/** Every value the demo processes get: the LOCAL stack only, checked by the safety gate before use. */
export function demoEnv(s: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SUPABASE_URL: s.API_URL,
    NEXT_PUBLIC_SUPABASE_URL: s.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: s.PUBLISHABLE_KEY ?? s.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY,
    SUPABASE_DB_URL: s.DB_URL,
    WORKER_DATABASE_URL: s.DB_URL,
    PUBLIC_APP_URL: URLS.web,
    NEXT_PUBLIC_APP_URL: URLS.web,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '54325',
    SMTP_SECURE: 'false',
    PAYMENTS_ALLOW_FAKE: 'true',
    PAYMENTS_WEBHOOKS: 'true',
    TRUST_PROXY_HOPS: '0',
    DEMO_MODE: '1',
    NEXT_DIST_DIR: '.next-demo',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const problems = safetyProblems(env);
  if (problems.length) fail(`refusing to run the demo:\n  - ${problems.join('\n  - ')}`);
  return env;
}

export async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/** Start a long-running process detached, output to .demo/logs/<name>.log; returns its pid. */
export function startProcess(name: string, args: string[], env: NodeJS.ProcessEnv, cwd = root): number {
  mkdirSync(LOGS, { recursive: true });
  const fd = openSync(path.join(LOGS, `${name}.log`), 'a');
  const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  closeSync(fd);
  child.unref();
  if (!child.pid) fail(`could not start ${name}`);
  return child.pid as number;
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Stop a process and everything it started (Windows: taskkill /T; elsewhere: the detached process group). */
export function stopProcess(pid: number): void {
  if (!alive(pid)) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}

export async function until(what: string, ms: number, check: () => Promise<boolean> | boolean): Promise<void> {
  // Counts attempts instead of reading a clock (purity lint); each wait is 500 ms, so the bound is the same.
  for (let waited = 0; waited < ms; waited += 500) {
    if (await Promise.resolve(check()).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500)); // polling observable state, not a fixed sleep
  }
  fail(`timed out after ${Math.round(ms / 1000)} s waiting for ${what} (see .demo/logs/)`);
}
