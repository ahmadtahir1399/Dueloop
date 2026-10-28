// Local Supabase stack values for the Playwright runs. Read from `supabase status -o json` (never written to disk
// or printed). Environment variables win, so CI can pass them explicitly.
import { execSync } from "node:child_process";
import path from "node:path";

export interface Stack {
  apiUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
  dbUrl: string;
  mailpitUrl: string;
}

let cached: Stack | undefined;

export function stack(): Stack {
  if (cached) return cached;
  const repoRoot = path.resolve(__dirname, "../../../..");
  let s: Record<string, string> = {};
  const e = process.env;
  if (!e.E2E_API_URL || !e.E2E_PUBLISHABLE_KEY || !e.E2E_SERVICE_ROLE_KEY || !e.E2E_DB_URL) {
    s = JSON.parse(execSync("pnpm exec supabase status -o json", { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as Record<string, string>;
  }
  const pick = (env: string | undefined, key: string) => {
    const v = env ?? s[key];
    if (!v) throw new Error(`local stack value missing: ${key}`);
    return v;
  };
  cached = {
    apiUrl: pick(e.E2E_API_URL, "API_URL"),
    publishableKey: pick(e.E2E_PUBLISHABLE_KEY, "PUBLISHABLE_KEY"),
    serviceRoleKey: pick(e.E2E_SERVICE_ROLE_KEY, "SERVICE_ROLE_KEY"),
    dbUrl: pick(e.E2E_DB_URL, "DB_URL"),
    mailpitUrl: pick(e.E2E_MAILPIT_URL, "MAILPIT_URL"),
  };
  return cached;
}

export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const BASE_URL = `http://localhost:${WEB_PORT}`;
