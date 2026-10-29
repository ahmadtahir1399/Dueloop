// post-restore.sql must recreate exactly the queues and cron jobs the migrations create (a dump carries neither).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const migrations = readdirSync(path.join(root, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'))
  .join('\n');
const post = readFileSync(path.join(root, 'packages/ops/sql/post-restore.sql'), 'utf8');

const queues = (s: string) => [...s.matchAll(/pgmq\.create\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
const jobs = (s: string) => {
  const out = new Map<string, string>();
  for (const m of s.matchAll(/cron\.schedule\('([^']+)',\s*'([^']+)',\s*\$\$(.*?)\$\$\)/g)) out.set(m[1] ?? '', `${m[2]} | ${m[3]}`);
  for (const m of s.matchAll(/cron\.unschedule\('([^']+)'\)/g)) out.delete(m[1] ?? '');
  return Object.fromEntries([...out].sort());
};

describe('post-restore.sql', () => {
  it('recreates every pgmq queue the migrations create', () => {
    expect(queues(post)).toEqual(queues(migrations));
    expect(queues(post).length).toBeGreaterThan(0);
  });
  it('recreates every cron job with the same schedule and command', () => {
    expect(jobs(post)).toEqual(jobs(migrations));
  });
  it('never sends: only queue, schedule and stamp statements', () => {
    const code = post.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/insert into public\.messages|claim_message|outbox/i);
  });
});
