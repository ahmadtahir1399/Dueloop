// Secret scanning for the working tree AND the full git history (prompt 7 issue E, rule 46).
// Pattern-based: each rule is a documented key format (prefix) or an unambiguous structure (PEM block, JWT, a URL
// with an inline password). It cannot see secrets with no recognisable shape; docs/limitations.md says so.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface SecretRule {
  id: string;
  re: RegExp;
}

export const SECRET_RULES: readonly SecretRule[] = [
  { id: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'stripe-secret-key', re: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}/ },
  { id: 'stripe-webhook-secret', re: /\bwhsec_[0-9A-Za-z+/=]{16,}/ },
  { id: 'anthropic-api-key', re: /\bsk-ant-[0-9A-Za-z_-]{20,}/ },
  // OpenAI publishes no key-format spec; secret scanners match the shared "T3BlbkFJ" marker (GitGuardian's OpenAI
  // detectors, OpenRouter's secret-format guide) and the project/service-account/admin prefixes.
  { id: 'openai-api-key', re: /\bsk-(?:(?:proj|svcacct|admin)-[0-9A-Za-z_-]{20,}|[0-9A-Za-z_-]{8,}T3BlbkFJ[0-9A-Za-z_-]{8,})/ },
  { id: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'github-token', re: /\b(?:gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,})/ },
  { id: 'slack-token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { id: 'slack-webhook-url', re: /hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9A-Za-z]{16,}/ },
  { id: 'supabase-secret-key', re: /\bsb_secret_[0-9A-Za-z_-]{16,}/ },
  { id: 'jwt', re: /\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{20,}/ },
  { id: 'url-with-password', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:([^\s@/'"`$]{6,})@(?!localhost\b|127\.0\.0\.1\b|db(?:[:/]|$)|\[::1\])[^\s'"`]+/i },
  { id: 'dueloop-api-key', re: /\bdl_[a-z0-9]{8}_[0-9A-Za-z_-]{30,}/ },
];

/**
 * Known non-secrets, each with a reason. A value here is matched EXACTLY (never a pattern), so a real key can
 * never hide behind an allowlist entry.
 */
export const SECRET_ALLOW: ReadonlyMap<string, string> = new Map([
  // Hostile-input fixtures in the error-scrubber test: built to look like secrets so the scrubber removes them.
  ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'scrubber test fixture (no key behind it)'],
  ['dl_ab12cd34_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEf', 'scrubber test fixture (no key behind it)'],
  ['dl_abcdefgh_SECRETSECRETSECRETSECRETSECRETSECRETSECRE', 'security suite: a never-issued key must not appear in the server log'],
]);

export interface SecretFinding {
  rule: string;
  where: string;
  /** Never the value: a short fingerprint so two reports can be compared. */
  fingerprint: string;
}

const fingerprint = (s: string) => `${s.slice(0, 6)}…(${s.length})`;

export function scanText(text: string, where: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const r of SECRET_RULES) {
      const m = r.re.exec(line);
      if (m && !SECRET_ALLOW.has(m[0])) out.push({ rule: r.id, where: `${where}:${i + 1}`, fingerprint: fingerprint(m[0]) });
    }
  });
  return out;
}

const git = (cwd: string, args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim().slice(0, 200)}`);
  return r.stdout;
};

/** Files git would commit: tracked plus untracked-but-not-ignored, read from disk (binary files skipped). */
export function treeFiles(cwd: string): string[] {
  return git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter((f) => f && existsSync(path.join(cwd, f)));
}

const isBinary = (b: Buffer) => b.subarray(0, 8000).includes(0);

export function scanTree(cwd: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const f of treeFiles(cwd)) {
    const bytes = readFileSync(path.join(cwd, f));
    if (!isBinary(bytes)) out.push(...scanText(bytes.toString('utf8'), f));
  }
  return out;
}

/** Every line ever ADDED in any commit reachable from any ref (history; issue E). */
export function scanHistory(cwd: string): SecretFinding[] {
  const log = git(cwd, ['log', '--all', '-p', '-U0', '--no-color', '--no-ext-diff', '--format=commit %H']);
  const out: SecretFinding[] = [];
  let commit = '';
  let file = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7, 19);
    else if (line.startsWith('+++ ')) file = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) {
      for (const f of scanText(line.slice(1), `${commit}:${file}`)) out.push({ ...f, where: f.where.replace(/:1$/, '') });
    }
  }
  return out;
}
