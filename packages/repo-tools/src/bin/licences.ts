// pnpm licences:report: the licence of every PRODUCTION dependency (all workspace packages), from each package's own
// package.json `license` field. Flags copyleft and unknown licences for review (prompt 7 issue D). Writes
// .reports/licences.json. Why not `pnpm licenses list`: under pnpm 12.15.0 it printed "No licenses in packages
// found" for this workspace (checked 2026-10-29), so this reads what `pnpm list --prod --json` resolves.
// Not legal advice: a package's declared licence field can be wrong or incomplete.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pnpmSpawn } from '../../../ops/scripts/pnpm-spawn.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
interface Node {
  version?: string;
  path?: string;
  dependencies?: Record<string, Node>;
}

const r = pnpmSpawn(['list', '-r', '--prod', '--json', '--depth', 'Infinity'], { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const projects = JSON.parse(String(r.stdout ?? '[]')) as { name: string; dependencies?: Record<string, Node> }[];
const seen = new Map<string, { name: string; version: string; license: string }>();
const walk = (deps: Record<string, Node> | undefined) => {
  for (const [name, n] of Object.entries(deps ?? {})) {
    const key = `${name}@${n.version ?? '?'}`;
    if (seen.has(key) || (n.version ?? '').startsWith('link:')) {
      walk(n.dependencies);
      continue;
    }
    // Optional platform packages for other OSes are resolved but not installed here; their licence is not readable.
    let license = 'NOT INSTALLED ON THIS PLATFORM (optional)';
    const pj = n.path ? path.join(n.path, 'package.json') : '';
    if (pj && existsSync(pj)) {
      const p = JSON.parse(readFileSync(pj, 'utf8')) as { license?: string | { type?: string }; licenses?: { type?: string }[] };
      license = typeof p.license === 'string' ? p.license : (p.license?.type ?? p.licenses?.map((l) => l.type).join(' OR ') ?? 'UNKNOWN');
    }
    seen.set(key, { name, version: n.version ?? '?', license });
    walk(n.dependencies);
  }
};
for (const p of projects) walk(p.dependencies);

const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|EUPL|CDDL|SSPL|OSL|CC-BY-SA)\b/i;
const byLicense = new Map<string, string[]>();
for (const d of seen.values()) byLicense.set(d.license, [...(byLicense.get(d.license) ?? []), `${d.name}@${d.version}`]);
const summary = [...byLicense].sort((a, b) => b[1].length - a[1].length).map(([license, pkgs]) => ({ license, packages: pkgs.length, review: COPYLEFT.test(license) || /UNKNOWN|UNLICENSED|SEE LICENSE/i.test(license) ? pkgs.slice(0, 8).join(', ') : '' }));
console.table(summary);
mkdirSync(path.join(root, '.reports'), { recursive: true });
writeFileSync(path.join(root, '.reports/licences.json'), `${JSON.stringify({ generated: 'pnpm licences:report', total: seen.size, summary, packages: [...seen.values()] }, null, 2)}\n`);
console.log(`${seen.size} production packages; report: .reports/licences.json`);
