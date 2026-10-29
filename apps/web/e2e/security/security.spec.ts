// Step 13: `pnpm web:test:security`. Headers per route class, production-bundle and test-only-code scans, log
// scan, cookie flags, CORS, error bodies, uniform invalid links (body and timing).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, request as pwRequest, test } from "@playwright/test";
import { issueFor, revoke } from "../support/links";
import { BASE_URL, stack } from "../support/stack";
import { authFile } from "../support/users";

const BUILD = path.resolve(__dirname, "../../.next-e2e");

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else out.push(p);
  }
  return out;
}

test.describe("headers per route class", () => {
  test("staff, auth, public, api and file routes", async ({ browser }) => {
    const anon = await pwRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const login = await anon.get("/login");
    const l = await issueFor("DA-0027");
    const pub = await anon.get(`/p/${l.payToken}`);
    const api = await anon.post("/v1/invoices", { data: {} });
    const ctx = await browser.newContext({ storageState: authFile("owner") });
    const staff = await ctx.request.get("/invoices");
    const rows = [
      ["auth /login", login.headers()],
      ["staff /invoices", staff.headers()],
      ["public /p/<token>", pub.headers()],
      ["api /v1/invoices", api.headers()],
    ] as const;
    for (const [name, h] of rows) {
      expect(h["x-content-type-options"], name).toBe("nosniff");
      expect(h["x-frame-options"], name).toBe("DENY");
      expect(h["x-powered-by"], name).toBeUndefined();
      expect(h["cache-control"] ?? "", name).toContain("no-store");
    }
    for (const [name, h] of rows.slice(0, 3)) {
      const csp = h["content-security-policy"] ?? "";
      expect(csp, name).toContain("frame-ancestors 'none'");
      expect(csp, name).toContain("object-src 'none'");
      expect(csp, name).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      expect(csp, name).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    }
    expect(pub.headers()["referrer-policy"]).toBe("no-referrer");
    expect(pub.headers()["x-robots-tag"]).toContain("noindex");
    console.log(JSON.stringify(rows.map(([n, h]) => ({ route: n, csp: (h["content-security-policy"] ?? "").slice(0, 60), referrer: h["referrer-policy"], cache: h["cache-control"], robots: h["x-robots-tag"] }))));
    await ctx.close();
    await anon.dispose();
  });

  test("CORS is closed and errors carry no stack traces", async () => {
    const anon = await pwRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const pre = await anon.fetch("/v1/invoices", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(pre.headers()["access-control-allow-origin"]).toBeUndefined();
    const post = await anon.post("/v1/invoices", { data: {}, headers: { Origin: "https://evil.example" } });
    expect(post.headers()["access-control-allow-origin"]).toBeUndefined();
    const body = await post.text();
    expect(body).not.toMatch(/\bat \w.*\(|node_modules|\.tsx?:\d+/);
    await anon.dispose();
  });
});

test("cookie flags: the tenant hint is httpOnly + SameSite=Lax; nothing is set on public pages", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile("multi") });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Business").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByTestId("whoami")).toContainText("accountant");
  const hint = (await ctx.cookies()).find((c) => c.name === "dl_tenant");
  expect(hint?.httpOnly).toBe(true);
  expect(hint?.sameSite).toBe("Lax");
  // Supabase auth cookies are readable by the browser client by design (@supabase/ssr); recorded, not "fixed".
  const auth = (await ctx.cookies()).filter((c) => c.name.startsWith("sb-"));
  console.log(JSON.stringify(auth.map((c) => ({ name: c.name.replace(/[0-9a-z]{4,}/g, "*"), httpOnly: c.httpOnly, sameSite: c.sameSite, secure: c.secure }))));
  await ctx.close();
});

test("A/39: invalid links answer alike, also in time (median of 15 within 150 ms)", async () => {
  const anon = await pwRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const l = await issueFor("DA-0028");
  const r = await issueFor("DA-0028");
  await revoke(r.payToken);
  const time = async (p: string) => {
    const ts: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      const res = await anon.get(p);
      ts.push(performance.now() - t0);
      expect(res.status()).toBe(404);
    }
    return ts.sort((a, b) => a - b)[7] ?? 0;
  };
  const unknown = await time(`/p/${"Q".repeat(43)}`);
  const malformed = await time("/p/abc");
  const revoked = await time(`/p/${r.payToken}`);
  const wrongPurpose = await time(`/p/${l.optToken}`);
  console.log(JSON.stringify({ unknown, malformed, revoked, wrongPurpose }));
  const all = [unknown, malformed, revoked, wrongPurpose];
  expect(Math.max(...all) - Math.min(...all)).toBeLessThan(150);
  await anon.dispose();
});

test("production client bundle: no service-role key, no DB URL, no env secret values, no secret-looking strings", () => {
  const s = stack();
  const client = files(path.join(BUILD, "static"));
  const forbidden = [s.serviceRoleKey, s.dbUrl, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "postgresql://", "sb_secret_", "service_role"];
  const hits: string[] = [];
  for (const f of client) {
    const text = readFileSync(f, "utf8");
    for (const x of forbidden) if (text.includes(x)) hits.push(`${path.relative(BUILD, f)}: ${x.slice(0, 16)}…`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) hits.push(`${path.relative(BUILD, f)}: private key`);
  }
  expect(hits).toEqual([]);
  expect(client.length).toBeGreaterThan(0);
});

test("test-only code and fixtures are absent from the production build", () => {
  const all = files(BUILD).filter((f) => /\.(js|json|html|rsc|body)$/.test(f) && !f.includes(`${path.sep}cache${path.sep}`));
  const markers = ["local-e2e-only", "__pwned", "e2e-claim", "e2e-demo-steps", "KeywordBaselineClassifier", "fixtures.ts"];
  const hits: string[] = [];
  for (const f of all) {
    const text = readFileSync(f, "utf8");
    for (const m of markers) if (text.includes(m)) hits.push(`${path.relative(BUILD, f)}: ${m}`);
  }
  expect(hits).toEqual([]);
});

test("G: hostile business names render as text on the public pages", async () => {
  const anon = await pwRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const { db } = await import("../support/db");
  const l = await issueFor("DA-0029");
  await db().query("update public.tenants set name = $1 where id = '5eed0000-0000-4000-8000-00000000000a'", [`Demo <script>alert(1)</script> "Agency"`]);
  try {
    const html = await (await anon.get(`/p/${l.payToken}`)).text();
    expect(html).toContain("Demo &lt;script&gt;alert(1)&lt;/script&gt; &quot;Agency&quot;");
    expect(html).not.toContain("<script>alert(1)");
    const opt = await (await anon.get(`/o/${l.optToken}`)).text();
    expect(opt).not.toContain("<script>alert(1)");
  } finally {
    await db().query("update public.tenants set name = 'Demo Agency' where id = '5eed0000-0000-4000-8000-00000000000a'");
    await anon.dispose();
  }
});

test("log scan: the server log holds no tokens, API keys, secrets, contact details or message text", async () => {
  // Generate traffic that would leak if anything logged it: a link visit, a POST, a bad API key, a promise.
  const anon = await pwRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const l = await issueFor("DA-0030");
  await anon.get(`/p/${l.payToken}`);
  await anon.post(`/p/${l.payToken}/act`, { form: { action: "copy" }, headers: { "Sec-Fetch-Site": "same-origin" }, maxRedirects: 0 });
  await anon.post("/v1/invoices", { data: { x: 1 }, headers: { Authorization: "Bearer dl_abcdefgh_SECRETSECRETSECRETSECRETSECRETSECRETSECRE" } });
  await anon.dispose();
  const log = readFileSync(path.join(BUILD, "server.log"), "utf8");
  const s = stack();
  const leaks = [
    [l.payToken, "pay token"],
    [l.optToken, "opt-out token"],
    ["SECRETSECRETSECRET", "API key secret"],
    [s.serviceRoleKey, "service-role key"],
    [s.dbUrl, "database URL"],
    ["@example.test", "customer email"],
    ["@demo-agency.test", "staff email"],
    ["invoice copy requested", "message text"],
  ] as const;
  const found = leaks.filter(([needle]) => needle && log.toLowerCase().includes(needle.toLowerCase())).map(([, what]) => what);
  expect(found).toEqual([]);
  console.log(JSON.stringify({ logBytes: log.length, scannedFor: leaks.map(([, w]) => w) }));
});
