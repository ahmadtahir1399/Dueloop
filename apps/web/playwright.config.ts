import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, stack, WEB_PORT } from "./e2e/support/stack";

// One production build of the web app against the LOCAL stack (NEXT_PUBLIC_ values are inlined at build time, so
// the e2e build is its own build in .next-e2e). Suites are Playwright projects selected by the pnpm scripts.
const s = stack();
const env = {
  NEXT_PUBLIC_SUPABASE_URL: s.apiUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: s.publishableKey,
  SUPABASE_URL: s.apiUrl,
  SUPABASE_SERVICE_ROLE_KEY: s.serviceRoleKey,
  SUPABASE_DB_URL: s.dbUrl,
  PUBLIC_APP_URL: BASE_URL,
  NEXT_DIST_DIR: ".next-e2e",
  // The FakeGateway is test/demo only (packages/payments registry); never set in production.
  PAYMENTS_ALLOW_FAKE: "true",
  TRUST_PROXY_HOPS: "0",
  NODE_ENV: "production",
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  globalSetup: "./e2e/support/global-setup.ts",
  projects: [
    { name: "e2e", testDir: "./e2e/staff", use: { ...devices["Desktop Chrome"] } },
    { name: "security", testDir: "./e2e/security", use: { ...devices["Desktop Chrome"] } },
    { name: "a11y", testDir: "./e2e/a11y", use: { ...devices["Desktop Chrome"] } },
    { name: "lowbandwidth", testDir: "./e2e/lowbandwidth", use: { ...devices["Pixel 7"] } },
    { name: "demo", testDir: "./e2e/demo", use: { ...devices["Desktop Chrome"] }, timeout: 600_000 },
    { name: "perf", testDir: "./e2e/perf", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // The server log goes to a file the security suite scans for secrets, tokens and contact details.
    command: `pnpm exec next build && pnpm exec next start -p ${WEB_PORT} > .next-e2e/server.log 2>&1`,
    url: `${BASE_URL}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    env,
    stdout: "pipe",
    stderr: "pipe",
  },
});
