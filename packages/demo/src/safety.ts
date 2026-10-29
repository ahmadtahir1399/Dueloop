// The demo's safety gate (prompt 7 demo contract, issue B). Pure: env in, problems out (names and reasons, never
// values). `pnpm demo` and `pnpm demo:control` refuse to run while any problem is reported.
import { randomBytes } from 'node:crypto';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** True for URLs (http, https, postgres) whose host is this machine. */
export function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** Variables that point the demo somewhere; each must be local when set. */
export const URL_VARS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_DB_URL', 'DATABASE_URL', 'WORKER_DATABASE_URL', 'PUBLIC_APP_URL', 'NEXT_PUBLIC_APP_URL', 'WEBHOOKS_PUBLIC_URL', 'MAILPIT_URL'] as const;

/**
 * Credentials that always reach a real provider when set: these providers have no test-mode key format we could
 * tell apart (Anthropic, OpenAI, WhatsApp Cloud API) or the variable only exists for live smoke checks.
 */
export const ALWAYS_LIVE_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_APP_SECRET', 'SENTRY_DSN', 'STRIPE_TEST_API_KEY'] as const;

/** Documented live-mode key prefixes (Stripe: https://docs.stripe.com/keys: pk_live_, rk_live_, sk_live_, sk_org_). */
const LIVE_KEY = /\b(?:[spr]k_live_|sk_org_)[0-9A-Za-z]/;

export function safetyProblems(env: Readonly<Record<string, string | undefined>>): string[] {
  const problems: string[] = [];
  for (const name of URL_VARS) {
    const v = env[name];
    if (v && !isLocalUrl(v)) problems.push(`${name} is not a local URL (the demo runs only against this machine)`);
  }
  const smtp = env.SMTP_HOST;
  if (smtp && !LOCAL_HOSTS.has(smtp)) problems.push('SMTP_HOST is not local (the demo sends only to the local mail catcher)');
  for (const name of ALWAYS_LIVE_VARS) if (env[name]) problems.push(`${name} is set: the demo never calls a real provider; unset it for the demo`);
  for (const [name, v] of Object.entries(env)) if (v && LIVE_KEY.test(v)) problems.push(`${name} looks like a live-mode provider key`);
  if (env.NODE_ENV === 'production') problems.push('NODE_ENV=production: the demo refuses to run in a production environment');
  return [...new Set(problems)];
}

/** A fresh password per demo run, shown once and never stored (24 random bytes, base64url). */
export function demoPassword(): string {
  return randomBytes(24).toString('base64url');
}
