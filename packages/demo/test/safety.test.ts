import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { demoPassword, isLocalUrl, safetyProblems } from '../src/safety.ts';

const live = (p: string) => `${p}${'A1b2C3d4'.repeat(3)}`;

describe('demo safety gate', () => {
  it('accepts the local stack', () => {
    expect(safetyProblems({ SUPABASE_URL: 'http://127.0.0.1:54321', WORKER_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', PUBLIC_APP_URL: 'http://localhost:3000', SMTP_HOST: '127.0.0.1' })).toEqual([]);
  });
  it('refuses any non-local database, API, app or mail URL', () => {
    const cases: [string, string][] = [
      ['WORKER_DATABASE_URL', 'postgresql://postgres:pw@db.project.example.com:5432/postgres'],
      ['SUPABASE_URL', 'https://project.example.com'],
      ['PUBLIC_APP_URL', 'https://app.example.com'],
      ['SUPABASE_DB_URL', 'postgres://u@127.0.0.1.evil.example/x'],
      ['NEXT_PUBLIC_SUPABASE_URL', 'not a url'],
    ];
    for (const [k, v] of cases)
      expect(safetyProblems({ [k]: v }).join(' ')).toContain(k);
    expect(safetyProblems({ SMTP_HOST: 'smtp.example.com' })).toHaveLength(1);
  });
  it('refuses live-looking keys under any name, and always-live provider credentials', () => {
    for (const p of ['sk_live_', 'rk_live_', 'pk_live_', 'sk_org_']) expect(safetyProblems({ SOMETHING: live(p) })).toEqual(['SOMETHING looks like a live-mode provider key']);
    expect(safetyProblems({ X: live('sk_test_') })).toEqual([]);
    expect(safetyProblems({ ANTHROPIC_API_KEY: 'x' })[0]).toContain('ANTHROPIC_API_KEY is set');
    expect(safetyProblems({ OPENAI_API_KEY: 'x' })[0]).toContain('OPENAI_API_KEY is set');
    expect(safetyProblems({ NODE_ENV: 'production' })).toHaveLength(1);
  });
  it('never echoes a value', () => {
    const v = live('sk_live_');
    expect(safetyProblems({ K: v }).join(' ')).not.toContain(v);
  });
  it('isLocalUrl', () => {
    expect(isLocalUrl('http://[::1]:3000')).toBe(true);
    expect(isLocalUrl('http://10.0.0.1')).toBe(false);
  });
});

describe('demo credentials (issue B)', () => {
  it('a fresh random password every run', () => {
    const a = demoPassword();
    const b = demoPassword();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
  it('no migration creates users or passwords; the seed users cannot sign in', () => {
    const dir = path.resolve(import.meta.dirname, '../../../supabase/migrations');
    for (const f of readdirSync(dir)) {
      const sql = readFileSync(path.join(dir, f), 'utf8');
      expect(sql, f).not.toMatch(/insert\s+into\s+auth\.users/i);
      expect(sql, f).not.toMatch(/encrypted_password|crypt\(/i);
    }
    const seed = readFileSync(path.resolve(import.meta.dirname, '../../../supabase/seed.sql'), 'utf8');
    expect(seed).not.toMatch(/encrypted_password|crypt\(/i);
  });
});
