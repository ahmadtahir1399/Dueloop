// Prompt 7 step 1: the env schema, .env.example and the code agree.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV, envExample, validateEnv } from '../src/env.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const SKIP = new Set(['node_modules', '.next', '.next-e2e', '.next-demo', 'test-results', 'dist', '.git', '.demo']);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (SKIP.has(f)) continue;
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(f)) out.push(p);
  }
  return out;
}

function namesReadInCode(): Set<string> {
  const names = new Set<string>();
  const files = [...walk(path.join(root, 'packages')), ...walk(path.join(root, 'apps/web')), ...walk(path.join(root, 'scripts'))];
  for (const f of files) {
    if (f.includes(`${path.sep}config${path.sep}src${path.sep}env.ts`)) continue;
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/\b(?:process\.env|env)\.([A-Z][A-Z0-9_]+)\b/g)) names.add(m[1] ?? '');
    for (const m of t.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g)) names.add(m[1] ?? '');
    for (const m of t.matchAll(/required\(['"]([A-Z][A-Z0-9_]+)['"]\)/g)) names.add(m[1] ?? '');
  }
  return names;
}

describe('environment schema', () => {
  it('every variable the code reads is in the schema (E2E_* test-harness variables excepted)', () => {
    const known = new Set(ENV.map((v) => v.name));
    const missing = [...namesReadInCode()].filter((n) => n && !known.has(n) && !n.startsWith('E2E_')).sort();
    expect(missing).toEqual([]);
  });

  it('.env.example is exactly what the schema generates', () => {
    expect(readFileSync(path.join(root, '.env.example'), 'utf8').replace(/\r\n/g, '\n')).toBe(envExample());
  });

  it('secrets never have an example value', () => {
    for (const v of ENV.filter((x) => x.secret)) expect(v.example, v.name).toBe('');
  });

  it('validation names the problem, never the value', () => {
    const secret = 'postgres-password-should-never-appear';
    const problems = validateEnv('web', { SUPABASE_DB_URL: `not-a-url-${secret}`, NODE_ENV: 'production', PAYMENTS_ALLOW_FAKE: 'true' });
    expect(problems.join(' ')).not.toContain(secret);
    expect(problems).toContain('SUPABASE_DB_URL has an invalid format');
    expect(problems).toContain('PUBLIC_APP_URL is required for web');
    expect(problems).toContain('PAYMENTS_ALLOW_FAKE must not be true in a production build');
  });
});
