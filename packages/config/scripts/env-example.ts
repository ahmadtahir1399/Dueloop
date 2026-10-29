// pnpm env:example [--check]: writes .env.example and docs/env-reference.md from the schema, or (--check) fails if
// either differs.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envExample, envMarkdown } from '../src/env.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const targets: [string, string][] = [
  ['.env.example', envExample()],
  ['docs/env-reference.md', envMarkdown()],
];
if (process.argv.includes('--check')) {
  const stale = targets.filter(([file, want]) => {
    let have = '';
    try {
      have = readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
    } catch {
      // missing file = stale
    }
    return have !== want;
  });
  if (stale.length) {
    console.error(`${stale.map(([f]) => f).join(', ')} stale: run \`pnpm env:example\`.`);
    process.exitCode = 1;
  } else console.log('.env.example and docs/env-reference.md match the env schema.');
} else {
  for (const [file, want] of targets) writeFileSync(path.join(root, file), want);
  console.log(`wrote ${targets.map(([f]) => f).join(', ')}`);
}
