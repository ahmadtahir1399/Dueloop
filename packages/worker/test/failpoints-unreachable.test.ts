// Proof that production code cannot reach a failpoint that does anything (Prompt 3, chaos section).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { WorkerDb } from '../src/db.ts';
import { NO_FAILPOINTS } from '../src/ports.ts';
import { buildDeps } from '../src/runtime.ts';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('failpoints are unreachable in production', () => {
  it('the composition root always wires the frozen no-op', () => {
    const db = new WorkerDb(new pg.Pool({ connectionString: 'postgres://unused@127.0.0.1:1/x' })); // never connects
    const deps = buildDeps({}, db, { now: () => new Date(0) });
    expect(deps.failpoints).toBe(NO_FAILPOINTS);
    expect(Object.isFrozen(NO_FAILPOINTS)).toBe(true);
    expect(() => NO_FAILPOINTS.hit('after_adapter', { idempotencyKey: 'k' })).not.toThrow();
    void db.pool.end();
  });

  it('no production file imports test code or builds another Failpoints', () => {
    for (const f of files(src)) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/from ['"][^'"]*test-db/);
      expect(text, f).not.toMatch(/crashAt\(|new FailpointCrash/);
      for (const m of text.matchAll(/\bfailpoints\s*:\s*([A-Za-z_]+)\s*[,}\n]/g)) expect(m[1], f).toBe('NO_FAILPOINTS');
    }
  });
});
