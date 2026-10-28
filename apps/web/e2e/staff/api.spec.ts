// Step 12: POST /v1/invoices (issue O).
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { db } from "../support/db";
import { BASE_URL, stack } from "../support/stack";
import { DEMO_TENANT, E2E_PASSWORD, USERS } from "../support/users";

test.use({ storageState: { cookies: [], origins: [] } });

async function newKey(): Promise<{ key: string; id: string }> {
  const s = stack();
  const c = createClient(s.apiUrl, s.publishableKey, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: USERS.owner.email, password: E2E_PASSWORD });
  const r = await c.rpc("create_api_key", { p_tenant: DEMO_TENANT, p_name: `e2e ${Date.now()}` });
  if (r.error || typeof r.data !== "string") throw new Error("key creation failed");
  const id = (await db().query("select id from public.api_keys where prefix = $1", [r.data.split("_")[1]])).rows[0].id as string;
  return { key: r.data, id };
}

const inv = (n: string, extra: Record<string, unknown> = {}) => ({
  number: n,
  customer: { name: `API Customer ${n}`, email: `api-${n.toLowerCase()}@example.test` },
  amount_minor: "125050",
  currency: "GBP",
  issued_on: "2026-09-01",
  due_on: "2026-10-01",
  ...extra,
});

let api: APIRequestContext;
test.beforeAll(async () => {
  api = await pwRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
});
test.afterAll(async () => api.dispose());

const post = (key: string | null, body: unknown, headers: Record<string, string> = {}) =>
  api.post("/v1/invoices", { data: body, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers } });

test("a valid batch is committed through the import RPC and the stored values are exact", async () => {
  const { key } = await newKey();
  const r = await post(key, { options: { default_country: "GB" }, invoices: [inv("API-1"), inv("API-2", { amount_minor: 99 })] });
  expect(r.status()).toBe(201);
  const body = await r.json();
  expect(body.counts.invoices.created).toBe(2);
  const rows = await db().query("select number, amount_total::text from public.invoices where tenant_id = $1 and number in ('API-1','API-2') order by number", [DEMO_TENANT]);
  expect(rows.rows).toEqual([{ number: "API-1", amount_total: "125050" }, { number: "API-2", amount_total: "99" }]);
});

test("mixed batch: all-or-nothing by default, the rest with skip_invalid", async () => {
  const { key } = await newKey();
  const batch = [inv("API-10"), inv("API-11", { due_on: "2026-02-30" })];
  const r1 = await post(key, { options: { default_country: "GB" }, invoices: batch });
  expect(r1.status()).toBe(422);
  expect((await r1.json()).error.code).toBe("invalid_invoices");
  expect((await db().query("select count(*)::int as n from public.invoices where number = 'API-10'")).rows[0].n).toBe(0);
  const r2 = await post(key, { options: { default_country: "GB", skip_invalid: true }, invoices: batch });
  expect(r2.status()).toBe(201);
  expect((await db().query("select count(*)::int as n from public.invoices where number = 'API-10'")).rows[0].n).toBe(1);
});

test("schema, currency, amount and duplicates are refused with one error shape and no stack trace", async () => {
  const { key } = await newKey();
  for (const [body, code] of [
    [{ options: { default_country: "GB" }, invoices: [inv("API-20", { currency: "gbp" })] }, "invalid_request"],
    [{ options: { default_country: "GB" }, invoices: [inv("API-21", { amount_minor: 12.5 })] }, "invalid_request"],
    [{ options: { default_country: "GB" }, invoices: [inv("API-22", { amount_minor: "0" })] }, "invalid_request"],
    [{ options: { default_country: "GB" }, invoices: [inv("API-23", { currency: "XXZ" })] }, "invalid_invoice"],
    [{ options: { default_country: "GB" }, invoices: [inv("API-24"), inv("API-24")] }, "invalid_invoices"],
    [{ options: { default_country: "GB" }, invoices: [inv("API-25", { amount_minor: "99999999999999999" })] }, "invalid_invoices"],
    [{ invoices: [] }, "invalid_request"],
  ] as const) {
    const r = await post(key, body);
    expect(r.status(), JSON.stringify(body).slice(0, 80)).toBe(422);
    const j = await r.json();
    expect(j.error.code).toBe(code);
    expect(JSON.stringify(j)).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
  }
  const notJson = await api.post("/v1/invoices", { data: Buffer.from("{not json"), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } });
  expect(notJson.status()).toBe(400);
});

test("oversize bodies are refused before parsing", async () => {
  const { key } = await newKey();
  const r = await api.post("/v1/invoices", { data: Buffer.alloc(1024 * 1024 + 10, 0x61), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } });
  expect(r.status()).toBe(413);
});

test("missing, malformed, unknown and revoked keys all get the same 401", async () => {
  const { key, id } = await newKey();
  await db().query("update public.api_keys set revoked_at = now() where id = $1", [id]);
  const answers = [];
  for (const k of [null, "nonsense", "dl_zzzzzzzz_" + "a".repeat(43), key, key.slice(0, -2) + "xx"]) {
    const r = await post(k, { options: { default_country: "GB" }, invoices: [inv("API-30")] });
    answers.push(`${r.status()}:${JSON.stringify(await r.json())}`);
  }
  expect(new Set(answers).size).toBe(1);
  expect(answers[0]).toContain("401");
});

test("Idempotency-Key: identical replay returns the stored answer; a different body is refused; concurrent calls create once", async () => {
  const { key } = await newKey();
  const body = { options: { default_country: "GB" }, invoices: [inv("API-40")] };
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => post(key, body, { "Idempotency-Key": "batch-40" })));
  const statuses = [a, b, c].map((x) => x?.status());
  expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
  for (const s of statuses) expect([201, 409]).toContain(s);
  const replay = await post(key, body, { "Idempotency-Key": "batch-40" });
  expect(replay.status()).toBe(201);
  expect(replay.headers()["idempotent-replayed"]).toBe("true");
  const changed = await post(key, { ...body, invoices: [inv("API-41")] }, { "Idempotency-Key": "batch-40" });
  expect(changed.status()).toBe(422);
  expect((await changed.json()).error.code).toBe("idempotency_key_reused");
  expect((await db().query("select count(*)::int as n from public.invoices where number = 'API-40'")).rows[0].n).toBe(1);
});

test("per-key rate limit answers 429", async () => {
  const { key } = await newKey();
  let limited = false;
  for (let i = 0; i < 70 && !limited; i++) {
    const r = await post(key, { invoices: [] });
    if (r.status() === 429) limited = true;
  }
  expect(limited).toBe(true);
});

test("only POST exists under /v1", async () => {
  expect((await api.get("/v1/invoices")).status()).toBe(405);
  expect([404, 405]).toContain((await api.get("/v1/customers")).status());
});

test("parity: the same invoices through the API and through the CSV import give the same rows", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { cli } = await import("../support/cli");
  const { OTHER_TENANT } = await import("../support/users");
  const { toCsv, API_MAPPING } = await import("../../lib/api/invoices");
  const { key } = await newKey();
  const req = { options: { default_country: "GB", skip_invalid: false }, invoices: [inv("PAR-1", { customer: { name: "Parity Ltd", email: "par@example.test", phone: "+44 20 7946 0958" } }), inv("PAR-2", { amount_minor: "7" })] };
  expect((await post(key, req)).status()).toBe(201);
  // The CSV the API builds is what a client would upload; import it with the CLI into the other tenant.
  const dir = mkdtempSync(path.join(tmpdir(), "parity-"));
  const csv = toCsv(req);
  if (!csv.ok) throw new Error("csv");
  writeFileSync(path.join(dir, "p.csv"), csv.csv);
  writeFileSync(path.join(dir, "m.json"), JSON.stringify(API_MAPPING));
  writeFileSync(path.join(dir, "o.json"), JSON.stringify({ delimiter: ",", decimal: ".", dateFormat: "YMD", defaultCountry: "GB", defaultCurrency: "GBP", timezone: "Europe/London" }));
  const c = cli(["import", "--tenant", OTHER_TENANT, "--file", path.join(dir, "p.csv"), "--mapping", path.join(dir, "m.json"), "--options", path.join(dir, "o.json")]);
  expect(c.code, c.out).toBe(0);
  const rows = async (t: string) =>
    (
      await db().query(
        `select i.number, i.amount_total::text, i.currency, i.issued_on::text, i.due_on::text, c.display_name, c.email, c.phone_e164
         from public.invoices i join public.customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
         where i.tenant_id = $1 and i.number like 'PAR-%' order by i.number`,
        [t],
      )
    ).rows;
  expect(await rows(OTHER_TENANT)).toEqual(await rows(DEMO_TENANT));
});
