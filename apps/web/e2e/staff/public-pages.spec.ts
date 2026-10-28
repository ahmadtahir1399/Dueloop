// Step 11: pay and opt-out pages (issues A-F, P; rules 35, 36, 39). Customers are not signed in: every test here
// uses an empty browser context, and the forms are exercised with JavaScript DISABLED.
import { expect, request as pwRequest, test } from "@playwright/test";
import { PNG_1x1 } from "../support/fixtures";
import { db } from "../support/db";
import { expire, issueFor, makeOverdue, revoke, writeSnapshot } from "../support/links";
import { BASE_URL } from "../support/stack";
import { DEMO_TENANT } from "../support/users";

test.use({ storageState: { cookies: [], origins: [] }, javaScriptEnabled: false });

const SCANNER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; Microsoft Office/16.0; SafeLinks scanner) LinkPreview",
  "Purpose": "prefetch",
  "Sec-Purpose": "prefetch",
};

test("B: GET of a pay page and an opt-out page writes nothing, even from link scanners", async () => {
  const l = await issueFor("DA-0017");
  const before = await writeSnapshot();
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  for (let i = 0; i < 3; i++) {
    for (const path of [`/p/${l.payToken}`, `/o/${l.optToken}`, `/o/${l.optToken}/unsubscribe`]) {
      const r = await ctx.get(path, { headers: SCANNER_HEADERS, maxRedirects: 0 });
      expect([200, 303]).toContain(r.status());
    }
  }
  await ctx.dispose();
  expect(await writeSnapshot()).toEqual(before);
});

test("public pages send the security headers and set no cookie", async () => {
  const l = await issueFor("DA-0017");
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const r = await ctx.get(`/p/${l.payToken}`);
  const h = r.headers();
  expect(h["cache-control"]).toContain("no-store");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["x-robots-tag"]).toContain("noindex");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(h["set-cookie"]).toBeUndefined();
  const html = await r.text();
  expect(html).not.toMatch(/googleapis|gstatic|analytics|cdn\./i); // no third-party fonts or scripts
  await ctx.dispose();
});

test("A/39: unknown, malformed, expired, revoked and wrong-purpose links get the same answer", async () => {
  const a = await issueFor("DA-0018");
  const b = await issueFor("DA-0018");
  const c = await issueFor("DA-0018");
  await expire(b.payToken);
  await revoke(c.payToken);
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const answers: { status: number; body: string }[] = [];
  for (const path of [`/p/${"x".repeat(43)}`, "/p/not-a-token", `/p/${b.payToken}`, `/p/${c.payToken}`, `/p/${a.optToken}`, `/o/${a.payToken}`]) {
    const r = await ctx.get(path);
    const body = (await r.text()).replace(/nonce-[^']+|nonce="[^"]+"|<script[\s\S]*?<\/script>/g, "");
    answers.push({ status: r.status(), body: body.includes("This link is no longer valid") ? "INVALID" : body.slice(0, 200) });
    expect(body).not.toContain("Demo Agency");
  }
  expect(new Set(answers.map((x) => `${x.status}:${x.body}`)).size).toBe(1);
  expect(answers[0]).toEqual({ status: 404, body: "INVALID" });
  await ctx.dispose();
});

test("pay page shows business, invoice and balance, never the customer's name or contact", async ({ page }) => {
  const l = await issueFor("DA-0019");
  await page.goto(`/p/${l.payToken}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demo Agency");
  await expect(page.getByTestId("pay-balance")).toContainText("£");
  const c = (await db().query("select display_name, email from public.customers where id = $1", [l.customerId])).rows[0];
  const html = await page.content();
  expect(html).not.toContain(c.display_name);
  if (c.email) expect(html).not.toContain(c.email);
});

test("E: a promise from the page goes through the reply pipeline (no JavaScript)", async ({ page }) => {
  const l = await issueFor("DA-0020");
  await makeOverdue(l.invoiceId);
  await page.goto(`/p/${l.payToken}`);
  const d = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  await page.getByLabel("Date").fill(d);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status")).toHaveText(/noted it|review it/);
  const msg = await db().query("select channel, direction, matched_by, processed_at is not null as done from public.messages m join public.message_invoices mi on mi.message_id = m.id where mi.invoice_id = $1 and m.channel = 'web'", [l.invoiceId]);
  expect(msg.rows[0]).toEqual({ channel: "web", direction: "in", matched_by: "pay_page_token", done: true });
  const inv = await db().query("select status, promised_on::text from public.invoices where id = $1", [l.invoiceId]);
  // Demo Agency accepts promises automatically; an overdue invoice becomes 'promised' with the typed date.
  expect(inv.rows[0]).toEqual({ status: "promised", promised_on: d });
});

test("E/26: a hostile promise date is refused by validatePromiseDate (task, not a promise)", async ({ request }) => {
  const l = await issueFor("DA-0021");
  await makeOverdue(l.invoiceId);
  const r = await request.post(`/p/${l.payToken}/act`, { form: { action: "promise", date: "2099-01-01" }, headers: { Origin: BASE_URL }, maxRedirects: 0 });
  expect(r.status()).toBe(303);
  expect(r.headers().location).toContain("done=promise_review");
  const inv = await db().query("select status from public.invoices where id = $1", [l.invoiceId]);
  expect(inv.rows[0].status).not.toBe("promised");
  const t = await db().query("select type, reason from public.tasks where invoice_id = $1 and type = 'review_promise'", [l.invoiceId]);
  expect(t.rows[0]).toEqual({ type: "review_promise", reason: "date_beyond_horizon" });
});

test("copy request makes one info_request task per day; proof upload lands in the proof inbox", async ({ page }) => {
  const l = await issueFor("DA-0022");
  await page.goto(`/p/${l.payToken}`);
  await page.getByRole("button", { name: "Request a copy" }).click();
  await expect(page.getByRole("status")).toContainText("asked to send you a copy");
  await page.getByRole("button", { name: "Request a copy" }).click();
  const tasks = await db().query("select count(*)::int as n from public.tasks where invoice_id = $1 and type = 'info_request'", [l.invoiceId]);
  expect(tasks.rows[0].n).toBe(1);
  await page.locator('input[type="file"]').setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG_1x1 });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("status")).toContainText("We received it");
  const p = await db().query("select status, mime from public.payment_proofs where invoice_id = $1", [l.invoiceId]);
  expect(p.rows).toEqual([{ status: "pending", mime: "image/png" }]);
  const inv = await db().query("select status from public.invoices where id = $1", [l.invoiceId]);
  expect(inv.rows[0].status).not.toBe("paid"); // a proof never marks anything paid
  await page.locator('input[type="file"]').setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("status")).toContainText("could not be accepted");
});

test("C: Pay creates the provider checkout only on POST and redirects without the token", async ({ request }) => {
  const l = await issueFor("DA-0023");
  // Connect the FakeGateway for Demo Agency (test mode) directly, as an owner would from Integrations.
  await db().query(
    `insert into public.payment_accounts (tenant_id, provider, mode, webhook_token_hash) values ($1, 'fake', 'test', repeat('c', 64))
     on conflict (tenant_id, provider) do update set enabled = true`,
    [DEMO_TENANT],
  );
  const acc = (await db().query("select id from public.payment_accounts where tenant_id = $1 and provider = 'fake'", [DEMO_TENANT])).rows[0].id;
  await db().query("select private.set_payment_secret($1, 'api_key', 'fake_test_key_0001')", [acc]);
  await db().query("select private.set_payment_secret($1, 'webhook_secret', 'fake_test_whsec_0001')", [acc]);
  const before = (await db().query("select count(*)::int as n from public.payment_requests where invoice_id = $1", [l.invoiceId])).rows[0].n;
  await request.get(`/p/${l.payToken}`);
  expect((await db().query("select count(*)::int as n from public.payment_requests where invoice_id = $1", [l.invoiceId])).rows[0].n).toBe(before);
  const r = await request.post(`/p/${l.payToken}/act`, { form: { action: "pay" }, headers: { Origin: BASE_URL }, maxRedirects: 0 });
  expect(r.status()).toBe(303);
  const loc = r.headers().location ?? "";
  expect(loc).toMatch(/^https:\/\/pay\.fake\.test\//);
  expect(loc).not.toContain(l.payToken);
  expect(r.headers()["referrer-policy"]).toBe("no-referrer");
  expect((await db().query("select count(*)::int as n from public.payment_requests where invoice_id = $1 and status = 'active'", [l.invoiceId])).rows[0].n).toBe(1);
});

test("POSTs need our Origin, a valid token and a small body", async ({ request }) => {
  const l = await issueFor("DA-0024");
  expect((await request.post(`/p/${l.payToken}/act`, { form: { action: "copy" }, maxRedirects: 0 })).status()).toBe(403);
  expect((await request.post(`/p/${l.payToken}/act`, { form: { action: "copy" }, headers: { Origin: "https://evil.example" }, maxRedirects: 0 })).status()).toBe(403);
  expect((await request.post(`/p/${"y".repeat(43)}/act`, { form: { action: "copy" }, headers: { Origin: BASE_URL }, maxRedirects: 0 })).status()).toBe(404);
  const big = await request.post(`/p/${l.payToken}/act`, { form: { action: "copy", pad: "x".repeat(10_000) }, headers: { Origin: BASE_URL }, maxRedirects: 0 });
  expect(big.status()).toBe(413);
  // A pay token cannot opt anyone out, and an opt-out token cannot act on an invoice.
  expect((await request.post(`/o/${l.payToken}/unsubscribe`, { form: { x: "1" }, headers: { Origin: BASE_URL }, maxRedirects: 0 })).status()).toBe(404);
  expect((await request.post(`/p/${l.optToken}/act`, { form: { action: "copy" }, headers: { Origin: BASE_URL }, maxRedirects: 0 })).status()).toBe(404);
});

test("F: opt-out page: GET asks, POST records via record_opt_out; RFC 8058 one-click works without Origin", async ({ page, request }) => {
  const l = await issueFor("DA-0025");
  await page.goto(`/o/${l.optToken}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Stop messages from Demo Agency?");
  expect((await db().query("select opted_out from public.customers where id = $1", [l.customerId])).rows[0].opted_out).toBe(false);
  await page.getByRole("button", { name: "Stop messages" }).click();
  await expect(page.getByRole("status")).toContainText("You will not receive further reminders");
  expect((await db().query("select opted_out from public.customers where id = $1", [l.customerId])).rows[0].opted_out).toBe(true);
  const consent = await db().query("select count(*)::int as n from public.tenant_events where customer_id = $1 and type = 'OptOutRecorded'", [l.customerId]);
  expect(consent.rows[0].n).toBeGreaterThan(0);

  const other = await issueFor("DA-0026");
  const one = await request.post(`/o/${other.optToken}/unsubscribe`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
  expect(one.status()).toBe(200);
  expect((await db().query("select opted_out from public.customers where id = $1", [other.customerId])).rows[0].opted_out).toBe(true);
});
