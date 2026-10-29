// pnpm docs:check (prompt 7 step 10, rule 44):
//   1. every relative link in a Markdown file points at a file that exists (external links are NOT checked: offline)
//   2. every `pnpm <script>` a document mentions exists in package.json (or is a pnpm built-in)
//   3. fenced blocks tagged `verified` (```bash verified) contain only commands a CI workflow runs; untagged command
//      blocks are listed as unverified (a count per file), never claimed
//   4. docs/decisions/README.md lists every ADR file
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeFiles } from '../secrets.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const scripts = new Set(Object.keys((JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts));
const BUILTIN = new Set(['install', 'exec', 'run', 'add', 'dlx', 'list', 'audit', 'licenses', 'why', 'update', 'store', '-s', '--silent', '--filter', '-r', 'test', 'lint', 'typecheck']);
const workflows = readdirSync(path.join(root, '.github/workflows')).map((f) => readFileSync(path.join(root, '.github/workflows', f), 'utf8')).join('\n');

const problems: string[] = [];
const unverified: Record<string, number> = {};
let verifiedCount = 0;
const docs = treeFiles(root).filter((f) => f.endsWith('.md') && !f.includes('node_modules'));
for (const f of docs) {
  const text = readFileSync(path.join(root, f), 'utf8');
  // 1. relative links
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1] ?? '';
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const file = target.split('#')[0] ?? '';
    if (file && !existsSync(path.resolve(path.dirname(path.join(root, f)), file))) problems.push(`${f}: broken link ${target}`);
  }
  // 2. pnpm script names (in inline code and fences; prose mentions of "pnpm" alone are ignored)
  for (const m of text.matchAll(/(?:`|^\s*)pnpm\s+(?:run\s+)?([a-z][\w:-]*)/gm)) {
    const name = m[1] ?? '';
    if (!scripts.has(name) && !BUILTIN.has(name)) problems.push(`${f}: \`pnpm ${name}\` is not a script in package.json`);
  }
  // 3. fences
  for (const m of text.matchAll(/^```(bash|sh|shell)([^\n]*)\n([\s\S]*?)^```/gm)) {
    const tagged = /\bverified\b/.test(m[2] ?? '');
    const lines = (m[3] ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!tagged) {
      unverified[f] = (unverified[f] ?? 0) + 1;
      continue;
    }
    for (const l of lines) {
      verifiedCount++;
      if (!workflows.includes(l)) problems.push(`${f}: "${l}" is tagged verified but no CI workflow runs it`);
    }
  }
}
// 4. ADR index
const adrDir = path.join(root, 'docs/decisions');
const index = existsSync(path.join(adrDir, 'README.md')) ? readFileSync(path.join(adrDir, 'README.md'), 'utf8') : '';
for (const adr of readdirSync(adrDir).filter((x) => /^\d{4}-.*\.md$/.test(x))) if (!index.includes(`(${adr})`)) problems.push(`docs/decisions/README.md does not list ${adr}`);

console.log(`${docs.length} Markdown files; ${verifiedCount} verified command lines (each run by a CI workflow).`);
const u = Object.entries(unverified);
if (u.length) console.log(`Unverified command blocks (not executed in CI; read them as instructions, not evidence):\n${u.map(([f, n]) => `  ${f}: ${n}`).join('\n')}`);
for (const p of problems) console.error(`FAIL ${p}`);
process.exitCode = problems.length ? 1 : 0;
