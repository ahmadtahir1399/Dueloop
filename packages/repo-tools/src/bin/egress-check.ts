// pnpm egress:check (prompt 7 issue I): best-effort static comparison of where RUNTIME code can send data with the
// list documented in docs/data-handling.md (the `<!-- egress: ... -->` comment). Fails when code reaches a destination
// the page does not list, or the page lists one the code no longer reaches.
// What it cannot see: URLs built at runtime (e.g. the media URL the WhatsApp Graph API returns), hosts configured
// through env or tenant settings (listed as config:* entries), destinations inside third-party SDKs beyond the known
// defaults below, and redirects. docs/data-handling.md says the same.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeFiles } from '../secrets.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
/** Runtime code only: services and the web app. Tests, scripts, demo and tooling never run in production. */
const RUNTIME = /^(packages\/(?!demo\/|repo-tools\/|sim\/)[^/]+\/src\/|apps\/web\/(app|lib)\/|apps\/web\/proxy\.ts$)/;
/** Placeholders and documentation hosts that are never contacted. */
const IGNORE = /(\.invalid|\.example|\.test|example\.(com|org|net)|^docs\.|localhost|127\.0\.0\.1)$/;
/** Outbound clients by import, and where each one sends (SDK defaults per their docs; env-configured otherwise). */
const CLIENTS: Record<string, string> = {
  '@anthropic-ai/sdk': 'api.anthropic.com',
  openai: 'api.openai.com',
  stripe: 'api.stripe.com',
  nodemailer: 'config:SMTP',
  imapflow: 'config:IMAP',
  '@supabase/supabase-js': 'config:SUPABASE',
  '@supabase/ssr': 'config:SUPABASE',
  pg: 'config:SUPABASE',
};

const found = new Map<string, string>();
for (const f of treeFiles(root).filter((x) => RUNTIME.test(x) && /\.(ts|tsx)$/.test(x) && !/\.test\.tsx?$/.test(x))) {
  const text = readFileSync(path.join(root, f), 'utf8');
  for (const m of text.matchAll(/['"`]https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = (m[1] ?? '').toLowerCase();
    if (!IGNORE.test(host) && !found.has(host)) found.set(host, f);
  }
  for (const m of text.matchAll(/from\s+['"](@?[a-z0-9./-]+)['"]/gi)) {
    const pkg = (m[1] ?? '').startsWith('@') ? (m[1] ?? '').split('/').slice(0, 2).join('/') : (m[1] ?? '').split('/')[0] ?? '';
    const dest = CLIENTS[pkg];
    if (dest && !found.has(dest)) found.set(dest, f);
  }
}

const page = readFileSync(path.join(root, 'docs/data-handling.md'), 'utf8');
const listed = new Set((/<!--\s*egress:([\s\S]*?)-->/.exec(page)?.[1] ?? '').split(/[\s,]+/).filter(Boolean));
const undocumented = [...found].filter(([d]) => !listed.has(d));
const stale = [...listed].filter((d) => !found.has(d));
console.table([...found].map(([destination, firstSeenIn]) => ({ destination, documented: listed.has(destination), firstSeenIn })));
for (const [d, f] of undocumented) console.error(`UNDOCUMENTED: ${d} (first seen in ${f}): add it to docs/data-handling.md with the fields sent`);
for (const d of stale) console.error(`STALE: ${d} is documented but no runtime code reaches it`);
process.exitCode = undocumented.length || stale.length ? 1 : 0;
