// The ONE environment schema (prompt 7 step 1). Every variable any service, CLI, script or test reads is listed
// here with who reads it, whether it is secret, and whether it is required. `.env.example` is GENERATED from this
// list (`pnpm env:example`), and a test fails if the code reads a variable that is not here, or if the file and
// the schema differ. Validation reports variable NAMES only, never values.

export type Service = 'web' | 'worker' | 'webhooks' | 'processor' | 'cli' | 'demo' | 'test' | 'smoke';

export interface EnvVar {
  readonly name: string;
  readonly secret: boolean;
  /** Services that refuse to start without it. */
  readonly requiredBy: readonly Service[];
  readonly usedBy: readonly Service[];
  readonly description: string;
  /** Shown in .env.example. Secrets never get a real-looking example. */
  readonly example: string;
  /** Format check (on the value, which is never printed). */
  readonly pattern?: RegExp;
}

const URL_RE = /^https?:\/\/[^\s]+$/;
const PG_RE = /^postgres(ql)?:\/\/[^\s]+$/;

export const ENV: readonly EnvVar[] = [
  { name: 'NODE_ENV', secret: false, requiredBy: [], usedBy: ['web'], description: 'production for builds and images.', example: 'production' },
  { name: 'NEXT_RUNTIME', secret: false, requiredBy: [], usedBy: ['web'], description: 'Set by Next.js itself (nodejs | edge); read by instrumentation. Do not set.', example: '' },
  { name: 'NEXT_PUBLIC_SUPABASE_URL', secret: false, requiredBy: ['web'], usedBy: ['web'], description: 'Supabase API URL the browser and the server use (public by design).', example: 'http://127.0.0.1:54321', pattern: URL_RE },
  { name: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', secret: false, requiredBy: ['web'], usedBy: ['web'], description: 'Supabase publishable (anon) key; public by design, RLS protects data.', example: 'sb_publishable_...' },
  { name: 'NEXT_PUBLIC_APP_URL', secret: false, requiredBy: [], usedBy: ['web'], description: 'Fallback origin for sign-up confirmation links.', example: 'http://localhost:3000', pattern: URL_RE },
  { name: 'PUBLIC_APP_URL', secret: false, requiredBy: ['web'], usedBy: ['web', 'worker'], description: 'Public base URL of the web app (pay/opt-out links, CSRF origin). https in production.', example: 'http://localhost:3000', pattern: URL_RE },
  { name: 'WEBHOOKS_PUBLIC_URL', secret: false, requiredBy: [], usedBy: ['web'], description: 'Public base URL of the webhook runtime, if different from PUBLIC_APP_URL.', example: 'https://hooks.example.com', pattern: URL_RE },
  { name: 'SUPABASE_URL', secret: false, requiredBy: ['web'], usedBy: ['web', 'worker', 'cli', 'test'], description: 'Supabase API URL for server-side code.', example: 'http://127.0.0.1:54321', pattern: URL_RE },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', secret: true, requiredBy: ['web'], usedBy: ['web', 'worker', 'cli', 'test'], description: 'Service-role key: server only (Storage signed URLs, staging the API import). Never NEXT_PUBLIC_.', example: '' },
  { name: 'SUPABASE_SECRET_KEY', secret: true, requiredBy: [], usedBy: ['web'], description: 'Alternative name for the server key (newer Supabase key format).', example: '' },
  { name: 'SUPABASE_DB_URL', secret: true, requiredBy: ['web'], usedBy: ['web', 'cli', 'test'], description: 'Direct Postgres URL for the web server trusted pipelines (contains the password).', example: '', pattern: PG_RE },
  { name: 'DATABASE_URL', secret: true, requiredBy: [], usedBy: ['web'], description: 'Fallback for SUPABASE_DB_URL in the web server.', example: '', pattern: PG_RE },
  { name: 'WORKER_DATABASE_URL', secret: true, requiredBy: ['worker', 'webhooks', 'processor'], usedBy: ['worker', 'webhooks', 'processor', 'cli', 'demo'], description: 'Direct Postgres URL for the worker, processor, webhook runtime and CLIs. Without it they use the LOCAL stack.', example: '', pattern: PG_RE },
  { name: 'SUPABASE_ANON_KEY', secret: false, requiredBy: [], usedBy: ['test'], description: 'Local anon key for integration tests (read from `supabase status` when unset).', example: '' },
  { name: 'SMTP_HOST', secret: false, requiredBy: [], usedBy: ['worker', 'web'], description: 'Default SMTP host (a tenant account can override when SMTP_ALLOW_TENANT_HOST=true).', example: '127.0.0.1' },
  { name: 'SMTP_PORT', secret: false, requiredBy: [], usedBy: ['worker', 'web'], description: 'Default SMTP port.', example: '54325', pattern: /^\d{1,5}$/ },
  { name: 'SMTP_SECURE', secret: false, requiredBy: [], usedBy: ['worker', 'web'], description: 'true for implicit TLS.', example: 'false', pattern: /^(true|false)$/ },
  { name: 'SMTP_USER', secret: false, requiredBy: [], usedBy: ['worker', 'web'], description: 'Default SMTP user (the password lives in Vault per tenant).', example: '' },
  { name: 'SMTP_ALLOW_TENANT_HOST', secret: false, requiredBy: [], usedBy: ['worker', 'web'], description: 'Let tenant channel config choose the SMTP host.', example: 'false', pattern: /^(true|false)$/ },
  { name: 'WHATSAPP_GRAPH_VERSION', secret: false, requiredBy: [], usedBy: ['worker', 'web'], description: 'Meta Graph API version; unset = no WhatsApp sending.', example: '' },
  { name: 'WHATSAPP_APP_SECRET', secret: true, requiredBy: [], usedBy: ['webhooks'], description: 'Meta app secret for webhook signatures; unset = WhatsApp webhook disabled.', example: '' },
  { name: 'WHATSAPP_VERIFY_TOKEN', secret: true, requiredBy: [], usedBy: ['webhooks'], description: 'Meta webhook verification token.', example: '' },
  { name: 'PAYMENTS_WEBHOOKS', secret: false, requiredBy: [], usedBy: ['webhooks'], description: 'true = serve /webhooks/payments/<token>.', example: 'true', pattern: /^(true|false)$/ },
  { name: 'PAYMENTS_ALLOW_FAKE', secret: false, requiredBy: [], usedBy: ['worker', 'web', 'webhooks', 'demo', 'test'], description: 'TESTS AND DEMO ONLY: enables the FakeGateway for test-mode accounts. Never set in production.', example: 'false', pattern: /^(true|false)$/ },
  { name: 'TRUST_PROXY_HOPS', secret: false, requiredBy: [], usedBy: ['web'], description: 'How many trusted proxies append X-Forwarded-For (0 = do not trust it).', example: '0', pattern: /^\d{1,2}$/ },
  { name: 'PORT', secret: false, requiredBy: [], usedBy: ['webhooks'], description: 'Webhook runtime port.', example: '8787', pattern: /^\d{1,5}$/ },
  { name: 'CLASSIFIER', secret: false, requiredBy: [], usedBy: ['processor'], description: 'anthropic or openai = classify replies with that provider model; unset = every reply becomes a human task.', example: '' },
  { name: 'CLASSIFIER_MODEL', secret: false, requiredBy: [], usedBy: ['processor'], description: 'Model id of the chosen provider (required when CLASSIFIER is set).', example: '' },
  { name: 'CLASSIFIER_TIMEOUT_MS', secret: false, requiredBy: [], usedBy: ['processor'], description: 'Classifier call timeout.', example: '30000', pattern: /^\d+$/ },
  { name: 'CLASSIFIER_FALLBACKS', secret: false, requiredBy: [], usedBy: ['processor'], description: 'false = no model fallback (Anthropic only).', example: 'true', pattern: /^(true|false)$/ },
  { name: 'ANTHROPIC_API_KEY', secret: true, requiredBy: [], usedBy: ['processor', 'worker', 'smoke'], description: 'Read by the Anthropic SDK when CLASSIFIER or PROOF_EXTRACTION is anthropic.', example: '' },
  { name: 'OPENAI_API_KEY', secret: true, requiredBy: [], usedBy: ['processor', 'worker'], description: 'Read by the OpenAI SDK when CLASSIFIER or PROOF_EXTRACTION is openai.', example: '' },
  { name: 'PROOF_EXTRACTION', secret: false, requiredBy: [], usedBy: ['worker'], description: 'anthropic or openai = AI hints on proof images (tenants must also opt in).', example: '' },
  { name: 'PROOF_EXTRACTION_MODEL', secret: false, requiredBy: [], usedBy: ['worker'], description: 'Model id for proof hints.', example: '' },
  { name: 'PROOF_EXTRACTION_FALLBACKS', secret: false, requiredBy: [], usedBy: ['worker'], description: 'false = no model fallback (Anthropic only).', example: 'true', pattern: /^(true|false)$/ },
  { name: 'NEXT_DIST_DIR', secret: false, requiredBy: [], usedBy: ['test'], description: 'Build folder (the e2e build uses .next-e2e).', example: '' },
  { name: 'SENTRY_DSN', secret: true, requiredBy: [], usedBy: [], description: 'Reserved: no error-reporting vendor is wired (ErrorReporter is a no-op by default).', example: '' },
  { name: 'ALERT_STALE_SECONDS', secret: false, requiredBy: [], usedBy: ['cli'], description: 'Watchdog: a heartbeat older than this is stale.', example: '300', pattern: /^\d+$/ },
  { name: 'OPS_ALERT_EMAIL', secret: false, requiredBy: [], usedBy: ['cli'], description: 'Watchdog: where system findings are emailed (SMTP defaults). Unset = exit code and JSON only.', example: '' },
  { name: 'OPS_ALERT_FROM', secret: false, requiredBy: [], usedBy: ['cli'], description: 'Watchdog: sender address for ops alerts.', example: '' },
  { name: 'NEXT_OUTPUT', secret: false, requiredBy: [], usedBy: ['web'], description: 'Build-time only: `standalone` makes next build emit the traced server the web image runs (set by the Dockerfile).', example: '' },
  { name: 'DUELOOP_SERVICE', secret: false, requiredBy: [], usedBy: ['worker', 'webhooks', 'processor'], description: 'Which service a services-image container runs (worker | processor | webhooks); picks the container healthcheck.', example: 'worker' },
  { name: 'HEALTH_MAX_AGE', secret: false, requiredBy: [], usedBy: ['worker', 'processor'], description: 'Container healthcheck: a heartbeat older than this many seconds is unhealthy (default 300).', example: '300', pattern: /^\d{1,5}$/ },
  { name: 'DEMO_WEB_PORT', secret: false, requiredBy: [], usedBy: ['demo'], description: 'pnpm demo: port of the demo web app (default 3000).', example: '3000', pattern: /^\d{1,5}$/ },
  { name: 'DEMO_WEBHOOKS_PORT', secret: false, requiredBy: [], usedBy: ['demo'], description: 'pnpm demo: port of the demo webhooks service (default 8787).', example: '8787', pattern: /^\d{1,5}$/ },
  { name: 'DEMO_RECORD', secret: false, requiredBy: [], usedBy: ['demo', 'test'], description: 'Set to 1 by pnpm demo:record: the e2e demo records video and keeps page DOMs for the leak check.', example: '' },
  { name: 'DEMO_RECORD_DOM', secret: false, requiredBy: [], usedBy: ['demo', 'test'], description: 'Set by pnpm demo:record: where the e2e demo writes the page DOMs it showed.', example: '' },
  { name: 'DEMO_MODE', secret: false, requiredBy: [], usedBy: ['demo'], description: 'Set by `pnpm demo` only; demo:control refuses without it.', example: '' },
  { name: 'DEMO_NOW', secret: false, requiredBy: [], usedBy: ['demo'], description: 'Demo clock passed to child processes.', example: '' },
  { name: 'NOW_ISO', secret: false, requiredBy: [], usedBy: ['demo'], description: 'Demo/script clock.', example: '' },
  { name: 'TENANT_ID', secret: false, requiredBy: [], usedBy: ['demo', 'smoke'], description: 'Tenant for scripts.', example: '' },
  { name: 'SEND_LOG', secret: false, requiredBy: [], usedBy: ['test'], description: 'Test harness log file.', example: '' },
  { name: 'APPLY_LOG', secret: false, requiredBy: [], usedBy: ['test'], description: 'Test harness log file.', example: '' },
  { name: 'MAILPIT_URL', secret: false, requiredBy: [], usedBy: ['demo', 'test'], description: 'Local mail catcher API.', example: 'http://127.0.0.1:54324' },
  { name: 'WEBHOOK_URL', secret: false, requiredBy: [], usedBy: ['smoke'], description: 'Smoke test target.', example: '' },
  { name: 'WEBHOOK_SMOKE', secret: false, requiredBy: [], usedBy: ['smoke'], description: '1 = run the live webhook smoke test.', example: '' },
  { name: 'WHATSAPP_SMOKE', secret: false, requiredBy: [], usedBy: ['smoke'], description: '1 = run the live WhatsApp smoke test.', example: '' },
  { name: 'WHATSAPP_TOKEN', secret: true, requiredBy: [], usedBy: ['smoke'], description: 'WhatsApp smoke test access token.', example: '' },
  { name: 'WHATSAPP_PHONE_NUMBER_ID', secret: false, requiredBy: [], usedBy: ['smoke'], description: 'WhatsApp smoke test sender.', example: '' },
  { name: 'WHATSAPP_SMOKE_TO', secret: false, requiredBy: [], usedBy: ['smoke'], description: 'WhatsApp smoke recipient (E.164).', example: '' },
  { name: 'WHATSAPP_SMOKE_TEMPLATE', secret: false, requiredBy: [], usedBy: ['smoke'], description: 'Approved template for the smoke test.', example: '' },
  { name: 'WHATSAPP_SMOKE_LANGUAGE', secret: false, requiredBy: [], usedBy: ['smoke'], description: 'Template language for the smoke test.', example: '' },
  { name: 'STRIPE_SMOKE', secret: false, requiredBy: [], usedBy: ['smoke'], description: '1 = run the Stripe test-mode smoke test.', example: '' },
  { name: 'STRIPE_TEST_API_KEY', secret: true, requiredBy: [], usedBy: ['smoke'], description: 'Stripe TEST-mode restricted key for the smoke test (never live).', example: '' },
  { name: 'EVAL_LIVE', secret: false, requiredBy: [], usedBy: ['smoke'], description: '1 = run the paid live classifier evaluation.', example: '' },
  { name: 'PROOF_EVAL', secret: false, requiredBy: [], usedBy: ['smoke'], description: '1 = run the paid live proof evaluation.', example: '' },
  { name: 'PROOF_EVAL_DIR', secret: false, requiredBy: [], usedBy: ['smoke'], description: 'Folder of labelled proof images for the live evaluation.', example: '' },
];

const BY_NAME = new Map(ENV.map((v) => [v.name, v]));
export const envVar = (name: string) => BY_NAME.get(name);

/** Fail-fast validation for one service. Returns problems as NAMES and reasons only; values are never included. */
export function validateEnv(service: Service, env: Readonly<Record<string, string | undefined>>): string[] {
  const problems: string[] = [];
  for (const v of ENV) {
    const value = env[v.name];
    if (v.requiredBy.includes(service) && (value === undefined || value === '')) problems.push(`${v.name} is required for ${service}`);
    if (value !== undefined && value !== '' && v.pattern && !v.pattern.test(value)) problems.push(`${v.name} has an invalid format`);
  }
  if (service !== 'demo' && service !== 'test' && env.PAYMENTS_ALLOW_FAKE === 'true' && env.NODE_ENV === 'production') {
    problems.push('PAYMENTS_ALLOW_FAKE must not be true in a production build');
  }
  return problems;
}

export function envExample(): string {
  const lines = [
    '# GENERATED by `pnpm env:example` from packages/config/src/env.ts. Do not edit by hand.',
    '# SECRET = never commit a value, never log it, never put it in a NEXT_PUBLIC_ variable.',
    '',
  ];
  for (const v of ENV) {
    lines.push(`# ${v.description}`);
    lines.push(`# ${v.secret ? 'SECRET' : 'not secret'}; ${v.requiredBy.length ? `required by: ${v.requiredBy.join(', ')}` : 'optional'}; used by: ${v.usedBy.join(', ') || 'nobody yet'}`);
    lines.push(`${v.name}=${v.secret ? '' : v.example}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** docs/env-reference.md: the same schema as a table (generated; `pnpm env:check` fails when it is stale). */
export function envMarkdown(): string {
  const cell = (s: string) => s.replaceAll('|', String.raw`\|`);
  const lines = [
    '# Environment reference',
    '',
    'GENERATED by `pnpm env:example` from `packages/config/src/env.ts`; do not edit by hand. Secret values never go in a',
    'file that is committed, a log line, an image layer or a `NEXT_PUBLIC_` variable.',
    '',
    '| Variable | Secret | Required by | Used by | Purpose |',
    '|---|---|---|---|---|',
  ];
  for (const v of ENV) lines.push(`| \`${v.name}\` | ${v.secret ? 'yes' : 'no'} | ${v.requiredBy.join(', ') || '-'} | ${v.usedBy.join(', ') || '-'} | ${cell(v.description)} |`);
  return `${lines.join('\n')}\n`;
}
