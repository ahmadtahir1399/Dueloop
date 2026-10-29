// Runtimes for the automated 7-step demo (step 15). Everything is the REAL code path: the worker CLI (send
// protocol, SMTP into Mailpit), the inbound processor (in-process, with the deterministic scripted classifier from
// demo:replies, because the CLI's default is "every reply is a human task"), the real webhook HTTP server and the
// payment pipeline. The only test-side pieces: the injected clock (--now), the scripted classifier, and the
// FakeGateway checkout stub (a Playwright route that stands in for pay.fake.test and delivers a signed webhook).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DateTime } from "luxon";
import { BASE_URL, stack } from "./stack";

const repoRoot = path.resolve(__dirname, "../../../..");

/** A moment inside the tenant's send window (09:00-19:00 Europe/London, weekday): now if inside, else next 10:00. */
export function demoClock(real = DateTime.utc()): DateTime {
  const local = real.setZone("Europe/London");
  if (local.hour >= 9 && local.hour < 19 && local.weekday <= 5) return local;
  let at = local.plus({ days: local.hour >= 19 ? 1 : 0 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (at.weekday > 5) at = at.plus({ days: 1 });
  return at;
}

export function runtimeEnv(): NodeJS.ProcessEnv {
  const s = stack();
  return {
    ...process.env,
    WORKER_DATABASE_URL: s.dbUrl,
    SUPABASE_URL: s.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: s.serviceRoleKey,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "54325",
    SMTP_SECURE: "false",
    PUBLIC_APP_URL: BASE_URL,
    PAYMENTS_ALLOW_FAKE: "true",
  };
}

/** A worker pass with the injected clock (the existing --now mechanism; a future instant only, as demo:send does). */
export function workerOnce(tenant: string, at: DateTime): string {
  const iso = at.toUTC().toISO() ?? "";
  const clockArgs = at.toMillis() - Date.now() > 60_000 ? ["--now", iso] : [];
  const r = spawnSync(process.execPath, ["packages/worker/src/bin/worker.ts", "--once", "--tenant", tenant, ...clockArgs], { cwd: repoRoot, env: runtimeEnv(), encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0) throw new Error(`worker exited ${r.status}: ${(r.stderr || r.stdout).slice(-600)}`);
  return r.stdout;
}

export function paymentsOnce(tenant: string): string {
  const r = spawnSync(process.execPath, ["packages/worker/src/bin/payments.ts", "process", "--once", "--tenant", tenant], { cwd: repoRoot, env: runtimeEnv(), encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0) throw new Error(`payments exited ${r.status}: ${(r.stderr || r.stdout).slice(-600)}`);
  return r.stdout;
}

export function integrity(): { code: number; out: string } {
  const r = spawnSync(process.execPath, ["packages/worker/src/bin/payments.ts", "integrity"], { cwd: repoRoot, env: runtimeEnv(), encoding: "utf8", timeout: 120_000 });
  return { code: r.status ?? -1, out: r.stdout };
}

const STEPS = "packages/worker/scripts/e2e-demo-steps.ts";
function steps(args: string[]): string {
  const r = spawnSync(process.execPath, [STEPS, ...args], { cwd: repoRoot, env: runtimeEnv(), encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0) throw new Error(`e2e-demo-steps ${args[0]} exited ${r.status}: ${(r.stderr || r.stdout).slice(-600)}`);
  return r.stdout;
}

/** A customer email threaded to our reminder, then the real processor with the scripted classifier. */
export function deliverEmailReply(tenantId: string, o: { invoiceNumber: string; from: string; body: string; at: Date }): string {
  return steps(["reply", tenantId, o.invoiceNumber, o.from, Buffer.from(o.body, "utf8").toString("base64"), o.at.toISOString()]);
}

/** The provider's signed link.paid delivery, POSTed to the real webhook route (in a child process). */
export function deliverPaidWebhook(o: { token: string; secret: string; link: string; amount: string; currency: string }): number {
  const last = steps(["pay-webhook", o.token, o.secret, o.link, o.amount, o.currency]).trim().split("\n").pop() ?? "{}";
  return Number((JSON.parse(last) as { status?: number }).status ?? 0);
}

// ---- Mailpit (the local mail catcher of the Supabase stack) ------------------------------------------------

interface MailSummary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

export async function mailpit<T>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${stack().mailpitUrl}${p}`, init);
  if (!r.ok) throw new Error(`mailpit ${p}: ${r.status}`);
  return (r.headers.get("content-type") ?? "").includes("json") ? ((await r.json()) as T) : ((await r.text()) as unknown as T);
}
export const clearMail = () => mailpit("/api/v1/messages", { method: "DELETE" });
export async function messagesTo(domain: string): Promise<MailSummary[]> {
  const r = await mailpit<{ messages: MailSummary[] }>("/api/v1/messages?limit=500");
  return r.messages.filter((m) => m.To.some((t) => t.Address.endsWith(domain)));
}
export async function mailText(id: string): Promise<string> {
  const m = await mailpit<{ Text: string }>(`/api/v1/message/${id}`);
  return m.Text;
}
export async function mailHeaders(id: string): Promise<Record<string, string[]>> {
  return mailpit<Record<string, string[]>>(`/api/v1/message/${id}/headers`);
}
