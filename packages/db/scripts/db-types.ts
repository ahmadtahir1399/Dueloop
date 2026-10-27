// pnpm db:types        -> regenerate packages/db/src/database.types.ts from the local database
// pnpm db:types:check  -> exit 1 if the committed file differs from what the database generates
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/database.types.ts');
const mode = process.argv[2];

const generated = execSync('supabase gen types --local --schema public', {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});

if (mode === 'write') {
  writeFileSync(target, generated);
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
} else if (mode === 'check') {
  const committed = readFileSync(target, 'utf8');
  // Line endings are normalised so a Windows checkout does not count as drift.
  if (committed.replace(/\r\n/g, '\n') !== generated.replace(/\r\n/g, '\n')) {
    console.error('database.types.ts is stale: run `pnpm db:types` and commit the result.');
    process.exitCode = 1;
  } else {
    console.log('database.types.ts matches the local database schema.');
  }
} else {
  console.error('usage: db-types.ts write|check');
  process.exitCode = 2;
}
