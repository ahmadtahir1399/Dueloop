// Pure-ish checks for `pnpm repo:audit`: fixture PII, claims (issue H), script portability, licence presence.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// ---- fixture PII: committed data must be synthetic ----------------------------------------------------------
// The last label must be alphabetic: `pnpm@12.15.0` and `user@127.0.0.1` are not addresses.
const EMAIL = /[a-z0-9._%+-]+@((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi;
/** RFC 2606 / RFC 6761 reserved names: .example, .test, .invalid, .localhost, and example.com/.net/.org. */
export const reservedDomain = (d: string) => /(^|\.)(example|test|invalid|localhost)$/i.test(d) || /(^|\.)example\.(com|net|org)$/i.test(d);

/** Ofcom's drama ranges (UK mobile 07700 900xxx, London 020 7946 0xxx) and the US fictional 555-01xx block. */
export const reservedPhone = (e164: string) => /^\+447700900\d{0,3}$/.test(e164) || /^\+44207946\d{0,4}$/.test(e164) || /^\+1\d{3}55501\d{2}$/.test(e164);

/** Exact values only, each with a reason. No range exists for these countries that we could cite. */
export const PHONE_ALLOW: ReadonlyMap<string, string> = new Map([
  ['+923001234567', 'PK placeholder (sequential digits); no reserved fictional range is published for Pakistan'],
  ['+923217654321', 'PK placeholder (reversed sequence); no reserved range for Pakistan'],
  ['+971501234567', 'AE placeholder (sequential digits); no reserved range for the UAE'],
  ['+49891234567', 'DE placeholder (sequential digits); no reserved range we could cite for Germany'],
  ['+49301234567', 'DE placeholder (sequential digits); no reserved range we could cite for Germany'],
]);
/** Files whose addresses are not ours: commented-out defaults of the Supabase CLI config template. */
export const PII_FILE_ALLOW: ReadonlyMap<string, string> = new Map([['supabase/config.toml', 'Supabase CLI template comments (an admin address of the CLI template)']]);

export interface Finding {
  where: string;
  detail: string;
}

export function piiFindings(text: string, file: string): Finding[] {
  if (PII_FILE_ALLOW.has(file)) return [];
  const out: Finding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(EMAIL)) {
      const domain = (m[1] ?? '').toLowerCase();
      if (!reservedDomain(domain)) out.push({ where: `${file}:${i + 1}`, detail: `email domain ${domain} is not a reserved test domain` });
    }
    for (const m of line.matchAll(/\+[1-9][0-9 ()-]{7,17}[0-9]/g)) {
      const e164 = m[0].replace(/[ ()-]/g, '');
      if (!reservedPhone(e164) && !PHONE_ALLOW.has(e164)) out.push({ where: `${file}:${i + 1}`, detail: `phone ${e164.slice(0, 5)}… is not in a reserved fictional range` });
    }
  });
  return out;
}

// ---- claims audit (issue H): no unbacked guarantees, compliance or numbers in user-facing docs --------------
export const FORBIDDEN_PHRASES: readonly RegExp[] = [
  /\b(enterprise|bank|military)[- ]grade\b/i,
  /\bunhackable\b|\bbullet-?proof\b/i,
  /\b100\s?%\s+(secure|safe|accurate|reliable|uptime)\b/i,
  /\b(GDPR|TCPA|HIPAA|PCI(?:[- ]DSS)?|SOC ?2|ISO ?27001|CCPA)[- ]?(compliant|certified|ready)\b/i,
  /\bfully compliant\b|\bcompliance guaranteed\b/i,
  /\bguarantee[sd]?\b/i,
  /\bROI\b|\breturn on investment\b/i,
  /\bsaves? (you )?(\d|hours|time|money)/i,
  /\bproduction[- ]ready\b|\bbattle[- ]tested\b/i,
];
/**
 * Prose numbers that read as a measurement or a promise: percentages, multipliers, money, and speed claims
 * ("in under 5 minutes", "within 2 seconds", "200 ms"). A configured period ("kept for 24 hours") is a contract, not
 * a measurement, and is not matched.
 */
const NUMBER_CLAIM = /\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?x (?:faster|cheaper|more|fewer)\b|[£$€]\s?\d|\b(?:under|less than|within|in) \d+(?:\.\d+)?\s?(?:ms|seconds?|minutes?|hours?)\b|\b\d+(?:\.\d+)?\s?ms\b/i;

/**
 * A line may carry `<!-- claims-ok: reason -->` (a disclaimer quoting a forbidden word) or
 * `<!-- measured: <path> -->` (the number comes from that command output or test file, which must exist).
 */
export function claimFindings(text: string, file: string, root: string): Finding[] {
  const out: Finding[] = [];
  let fenced = false;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) return;
    const where = `${file}:${i + 1}`;
    // A marker applies to its own line, or to the next line when it stands alone on the line before.
    const prev = lines[i - 1] ?? '';
    const ctx = /^\s*<!--[^>]*-->\s*$/.test(prev) ? `${line}\n${prev}` : line;
    if (/<!--\s*claims-ok:\s*\S/.test(ctx)) return;
    for (const re of FORBIDDEN_PHRASES) if (re.test(line)) out.push({ where, detail: `forbidden phrase ${re.source.slice(0, 40)}` });
    const prose = line.replace(/`[^`]*`/g, '');
    if (NUMBER_CLAIM.test(prose)) {
      const m = /<!--\s*measured:\s*([^\s>]+)\s*-->/.exec(ctx);
      if (!m) out.push({ where, detail: 'a number that reads as a measurement has no <!-- measured: path --> source' });
      else if (!existsSync(path.join(root, m[1] ?? ''))) out.push({ where, detail: `measured source ${m[1]} does not exist` });
    }
  });
  return out;
}

// ---- script portability: package.json scripts must run under cmd.exe and sh ----------------------------------
const BASH_ONLY: readonly [RegExp, string][] = [
  [/\$\(|`/, 'command substitution'],
  [/(^|&&\s*|;\s*)[A-Z_][A-Z0-9_]*=\S+\s/, 'inline VAR=value prefix'],
  [/\bexport\s+[A-Z_]/, 'export'],
  [/\b(rm|cp|mv|cat|grep|sed|awk|sleep|mkdir -p|chmod)\b/, 'POSIX utility'],
  [/'/, "single quotes (cmd.exe does not strip them)"],
  [/\bsource\b|\s\.\s\//, 'source'],
];

export function scriptFindings(pkgFile: string, scripts: Record<string, string>): Finding[] {
  const out: Finding[] = [];
  for (const [name, cmd] of Object.entries(scripts)) for (const [re, why] of BASH_ONLY) if (re.test(cmd)) out.push({ where: `${pkgFile}#${name}`, detail: why });
  return out;
}

// ---- licence presence per the owner's decision ---------------------------------------------------------------
/** The owner's decision (prompt 7 facts). null = blank: NO licence file may exist until they decide. */
export const LICENCE_DECISION: string | null = null;

export function licenceFindings(root: string): Finding[] {
  const files = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING'].filter((f) => existsSync(path.join(root, f)));
  if (LICENCE_DECISION === null) {
    const out: Finding[] = files.map((f) => ({ where: f, detail: 'a licence file exists but the licence decision is blank' }));
    const readme = existsSync(path.join(root, 'README.md')) ? readFileSync(path.join(root, 'README.md'), 'utf8') : '';
    if (!/TODO\(licence\)/.test(readme)) out.push({ where: 'README.md', detail: 'README must say the licence is pending: TODO(licence)' });
    return out;
  }
  return files.length ? [] : [{ where: '.', detail: `licence decision is ${LICENCE_DECISION} but no LICENSE file exists` }];
}

// ---- undeclared runtime dependencies: a container installs only declared ones ---------------------------------
const IMPORT_LINE = /^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** Bare package names a source file imports (relative paths, node: builtins and `@/` aliases excluded). */
export function importedPackages(source: string, builtins: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(IMPORT_LINE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? '';
    if (!spec || spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('@/')) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? '');
    if (!builtins.has(name)) out.add(name);
  }
  return [...out];
}

export function dependencyFindings(pkgFile: string, pkg: { name?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }, sources: { file: string; text: string }[], builtins: ReadonlySet<string>): Finding[] {
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {}), pkg.name ?? '']);
  const out: Finding[] = [];
  for (const s of sources) for (const n of importedPackages(s.text, builtins)) if (!declared.has(n)) out.push({ where: s.file, detail: `imports ${n}, not in ${pkgFile} dependencies` });
  return out;
}
