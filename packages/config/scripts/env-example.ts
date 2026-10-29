// pnpm env:example [--check]: writes .env.example from the schema, or (--check) fails if it differs.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envExample } from '../src/env.ts';

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env.example');
const want = envExample();
if (process.argv.includes('--check')) {
  let have = '';
  try {
    have = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // missing file = stale
  }
  if (have !== want) {
    console.error('.env.example is stale: run `pnpm env:example`.');
    process.exitCode = 1;
  } else console.log('.env.example matches the env schema.');
} else {
  writeFileSync(target, want);
  console.log('wrote .env.example');
}
