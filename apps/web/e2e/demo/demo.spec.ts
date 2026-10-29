// Step 15: the 7-step demo, end to end, against the real local stack (`pnpm e2e:demo`). Fresh tenant, real
// import wizard, real worker (injected clock), real processor, real webhook route + payment pipeline, real
// SMTP into Mailpit. No fixed sleeps: every wait is on observable state. Prints a step / assertion / result table.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { DateTime } from "luxon";
import { db } from "../support/db";
import {
  clearMail,
  deliverEmailReply,
  deliverPaidWebhook,
  demoClock,
  integrity,
  mailHeaders,
  mailText,
  messagesTo,
  paymentsOnce,
  workerOnce,
} from "../support/demo-runtime";
import { BASE_URL, stack } from "../support/stack";

const DOMAIN = "@freshdemo.example.test";
const table: { step: string; assertion: string; result: string }[] = [];
const record = (step: string, assertion: string, ok: boolean) => table.push({ step, assertion, result: ok ? "PASS" : "FAIL" });

function csv40(today: DateTime): { text: string; overdue: { number: string; minor: number }[] } {
  const lines = ["invoice_no,customer,email,amount,currency,issued,due"];
  const overdue: { number: string; minor: number }[] = [];
  for (let i = 1; i <= 40; i++) {
    const isOverdue = i <= 12;
    const due = isOverdue ? today.minus({ days: 3 + i * 4 }) : today.plus({ days: 5 + i });
    const minor = 10_000 + i * 1_234;
    if (isOverdue) overdue.push({ number: `FD-${String(i).padStart(3, "0")}`, minor });
    lines.push([`FD-${String(i).padStart(3, "0")}`, `Fresh Customer ${i}`, `c${i}${DOMAIN}`, (minor / 100).toFixed(2), "GBP", due.minus({ days: 30 }).toISODate(), due.toISODate()].join(","));
  }
  return { text: `${lines.join("\n")}\n`, overdue };
}

async function signUpOwner(page: Page) {
  const s = stack();
  const admin = createClient(s.apiUrl, s.serviceRoleKey, { auth: { persistSession: false } });
  const email = `demo-owner-${Date.now()}@e2e.test`;
  const password = randomBytes(18).toString("base64url"); // per-run random, never printed
  const c = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (c.error) throw new Error("could not create the demo owner");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/onboarding$/);
  return email;
}

test.use({ timezoneId: "Europe/London" });

test("the 7-step demo, end to end", async ({ page, context }) => {
  test.setTimeout(600_000);
  // `pnpm demo:record` only: keep the DOM of every page the video shows, so its text can be leak-checked (issue O).
  if (process.env.DEMO_RECORD === "1") {
    const dir = process.env.DEMO_RECORD_DOM ?? "";
    mkdirSync(dir, { recursive: true });
    let n = 0;
    page.on("load", async () => {
      const html = await page.content().catch(() => "");
      writeFileSync(path.join(dir, `${String(++n).padStart(3, "0")}.html`), html);
    });
  }
  const at = demoClock();
  const today = at.startOf("day");
  await clearMail();

  // ---- Step 1: fresh tenant, CSV through the wizard, 12 overdue, ageing visible --------------------------------
  const ownerEmail = await signUpOwner(page);
  await page.getByLabel("Business name").fill("Fresh Demo Co");
  // The injected clock (demoClock) is a moment inside a London send window, so the tenant must be in London too.
  // Onboarding defaults to Asia/Karachi; leaving it there made the run depend on the time of day (it failed once
  // London's window was open but Karachi's was not).
  await page.getByLabel("Time zone").click();
  await page.getByRole("option", { name: "Europe/London", exact: true }).click();
  await page.getByLabel("Main currency").fill("GBP");
  await page.getByRole("button", { name: /Create/ }).click();
  await page.waitForURL((u) => u.pathname === "/" || u.pathname === "/import");
  const created = (await db().query<{ id: string; timezone: string }>("select id, timezone from public.tenants where name = 'Fresh Demo Co' order by created_at desc limit 1")).rows[0];
  const tenant = created?.id ?? "";
  expect(tenant).not.toBe("");
  expect(created?.timezone, "the demo clock assumes the tenant is in Europe/London").toBe("Europe/London");
  // Onboarding now adds the standard email templates; the demo also copies the seed's WhatsApp template.
  expect((await db().query("select count(*)::int as n from public.templates where tenant_id = $1 and channel = 'email'", [tenant])).rows[0].n).toBeGreaterThanOrEqual(3);
  // Setup an owner does in Settings > Integrations: a sending address for SMTP (Mailpit here).
  await db().query(`insert into public.channel_accounts (tenant_id, channel, config) values ($1, 'email', '{"from_address": "billing@fresh-demo.test", "from_name": "Fresh Demo Co", "message_id_domain": "fresh-demo.test"}')`, [tenant]);
  await db().query(
    `insert into public.templates (tenant_id, template_key, channel, locale, tone, subject, body, provider_template_name, provider_language, provider_status)
     select $1, template_key, channel, locale, tone, subject, body, provider_template_name, provider_language, provider_status
     from public.templates where tenant_id = '5eed0000-0000-4000-8000-00000000000a'
     on conflict (tenant_id, template_key, channel, locale) do nothing`,
    [tenant],
  );
  const data = csv40(today);
  await page.goto("/import");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles({ name: "invoices.csv", mimeType: "text/csv", buffer: Buffer.from(data.text) });
  await page.getByRole("combobox", { name: "Date format *" }).click();
  await page.getByRole("option", { name: /^YMD/ }).click();
  await page.getByLabel("Phone country *").fill("GB");
  await page.getByRole("button", { name: "Preview import (dry run)" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Import complete")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("kpi-overdue")).toContainText("12 invoices");
  const ageing = page.getByRole("table", { name: /Open balances by age, GBP/ });
  await expect(ageing).toBeVisible();
  record("1", "40 imported through the wizard; 12 overdue; ageing table visible", true);

  // ---- Step 2: enqueue + worker (injected clock): approvals; bulk-approve in the UI; send; second run sends nothing --
  workerOnce(tenant, at);
  const pending = (await db().query<{ n: number }>("select count(*)::int as n from public.approvals where tenant_id = $1 and status = 'pending'", [tenant])).rows[0]?.n ?? 0;
  expect(pending).toBeGreaterThan(0);
  await page.goto("/approvals");
  await page.waitForLoadState("networkidle"); // hydrated: a checkbox ticked before hydration can be reset
  const bulk = page.getByRole("form", { name: "Approve several" });
  const boxes = bulk.getByRole("checkbox");
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  for (let i = 0; i < n; i++) await expect(boxes.nth(i)).toBeChecked();
  await bulk.getByLabel("Type how many you selected, to confirm").fill(String(n));
  await bulk.getByRole("button", { name: "Approve selected" }).click();
  await expect(bulk.getByRole("status").or(page.getByText("Nothing waiting for approval"))).toBeVisible();
  workerOnce(tenant, at);
  await expect.poll(async () => (await messagesTo(DOMAIN)).length, { timeout: 60_000 }).toBe(n);
  workerOnce(tenant, at);
  expect((await messagesTo(DOMAIN)).length).toBe(n);
  record("2", `approvals requested (${pending}); ${n} approved in the UI; ${n} emails in Mailpit; second run sends 0`, true);

  // The real emails carry OUR pay link and the opt-out link (and the RFC 8058 headers only for https; local is http).
  const mails = await messagesTo(DOMAIN);
  // Read what step 6 needs before Mailpit is cleared between steps.
  const captured = new Map<string, { id: string; text: string; headers: Record<string, string[]> }>();
  for (const m of mails.slice(0, 3)) captured.set(m.To[0]?.Address ?? "", { id: m.ID, text: await mailText(m.ID), headers: await mailHeaders(m.ID) });
  const byCustomer = (k: number) => {
    const m = captured.get(`c${k}${DOMAIN}`);
    if (!m) throw new Error(`no email to c${k}`);
    return m;
  };

  // ---- Step 3: "Can't pay until the 15th, sorry." -> promised, reminders paused, alert ----------------------------
  const firstSent = mails.length ? Number(/c(\d+)@/.exec(mails[0]?.To[0]?.Address ?? "")?.[1]) : 1;
  const num3 = `FD-${String(firstSent).padStart(3, "0")}`;
  await clearMail();
  deliverEmailReply(tenant, { invoiceNumber: num3, from: `Fresh Customer ${firstSent} <c${firstSent}${DOMAIN}>`, body: "Can't pay until the 15th, sorry.", at: at.toJSDate() });
  const inv3 = (await db().query<{ id: string; status: string; promised_on: string | null; next: Date }>("select id, status, promised_on::text, next_action_at as next from public.invoices where tenant_id = $1 and number = $2", [tenant, num3])).rows[0];
  expect(inv3?.status).toBe("promised");
  expect(inv3?.promised_on?.endsWith("-15")).toBe(true);
  expect(new Date(inv3?.next ?? 0).getTime()).toBeGreaterThan(at.toMillis());
  // The owner alert: Slack only accepts hooks.slack.com URLs, so locally the alert takes the email-to-owners route.
  await expect.poll(async () => (await messagesTo("@e2e.test")).filter((m) => m.To.some((t) => t.Address === ownerEmail)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  record("3", `${num3} promised on the 15th, next action after the promise, owner alert received (email route)`, true);

  // ---- Step 4: timeline -----------------------------------------------------------------------------------------
  await page.goto(`/invoices/${inv3?.id}`);
  const timeline = page.getByTestId("timeline");
  for (const label of ["Imported", "Approved", "Reminder sent", "Promise to pay recorded"]) await expect(timeline).toContainText(label);
  await expect(timeline.locator("time").first()).toHaveText(/\d{1,2} \w{3} \d{4}, \d{2}:\d{2}/);
  record("4", "timeline shows each event with a tenant-zone timestamp", true);

  // ---- Step 5: "already paid" -> verification task, status unchanged, reminders paused ---------------------------
  const second = Number(/c(\d+)@/.exec(mails[1]?.To[0]?.Address ?? "")?.[1]);
  const num5 = `FD-${String(second).padStart(3, "0")}`;
  const before5 = (await db().query<{ status: string }>("select status from public.invoices where tenant_id = $1 and number = $2", [tenant, num5])).rows[0]?.status;
  deliverEmailReply(tenant, { invoiceNumber: num5, from: `c${second}${DOMAIN}`, body: "Already paid, sent the transfer yesterday.", at: at.toJSDate() });
  const t5 = await db().query<{ type: string; until: Date | null }>("select t.type, t.blocks_reminders_until as until from public.tasks t join public.invoices i on i.id = t.invoice_id where i.tenant_id = $1 and i.number = $2", [tenant, num5]);
  const after5 = (await db().query<{ status: string }>("select status from public.invoices where tenant_id = $1 and number = $2", [tenant, num5])).rows[0]?.status;
  expect(t5.rows.some((r) => r.type === "verify_payment_claim" && r.until !== null)).toBe(true);
  expect(after5).toBe(before5);
  record("5", `${num5}: verify_payment_claim task, reminders paused, status unchanged (${after5}), nothing closed`, true);

  // ---- Step 6: pay link from the REAL email -> pay page -> Pay -> FakeGateway stub -> signed webhook -> paid --------
  const third = Number(/c(\d+)@/.exec(mails[2]?.To[0]?.Address ?? "")?.[1]);
  const num6 = `FD-${String(third).padStart(3, "0")}`;
  const mail6 = byCustomer(third);
  const payUrl = /(http:\/\/localhost:\d+\/p\/[A-Za-z0-9_-]{43})/.exec(mail6.text)?.[1];
  const optUrl = /(http:\/\/localhost:\d+\/o\/[A-Za-z0-9_-]{43})/.exec(mail6.text)?.[1];
  expect(payUrl).toBeTruthy();
  expect(optUrl).toBeTruthy();
  const hdrs = mail6.headers;
  expect(Object.keys(hdrs).some((k) => k.toLowerCase() === "list-unsubscribe")).toBe(false); // http base: no one-click header (RFC 8058 needs https)
  // Connect the FakeGateway (test mode) as an owner would; the webhook URL token is opaque and hashed.
  const whToken = randomBytes(32).toString("base64url");
  const whSecret = `whsec_e2e_${randomBytes(8).toString("hex")}`;
  const acc = (await db().query<{ id: string }>("insert into public.payment_accounts (tenant_id, provider, mode, webhook_token_hash) values ($1, 'fake', 'test', $2) returning id", [tenant, createHash("sha256").update(whToken).digest("hex")])).rows[0]?.id;
  await db().query("select private.set_payment_secret($1, 'webhook_secret', $2)", [acc, whSecret]);
  await db().query("select private.set_payment_secret($1, 'api_key', 'fake_test_key_e2e')", [acc]);
  await clearMail();
  // The browser POSTs "Pay now"; the answer is a 303 to the provider's hosted checkout (never carrying our token).
  // Playwright does not intercept the redirected navigation, so the test reads the 303 and plays the provider:
  // the FakeGateway "checkout" completes and sends its signed link.paid webhook to our real webhook route.
  await page.goto(payUrl ?? "");
  const actResponse = page.waitForResponse((r) => r.url().endsWith("/act") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Pay now" }).click();
  const act = await actResponse;
  expect(act.status()).toBe(303);
  const location = (await act.allHeaders()).location ?? "";
  expect(location).toMatch(/^https:\/\/pay\.fake\.test\/plink_/);
  expect(location).not.toContain(payUrl?.split("/").pop() ?? "x");
  const link = new URL(location).pathname.slice(1);
  const req = (await db().query<{ amount: string; currency: string }>("select amount::text, currency from public.payment_requests where provider_object_id = $1", [link])).rows[0];
  expect(deliverPaidWebhook({ token: whToken, secret: whSecret, link, amount: req?.amount ?? "0", currency: req?.currency ?? "GBP" })).toBe(200);
  paymentsOnce(tenant);
  const inv6 = (await db().query<{ id: string; status: string }>("select id, status from public.invoices where tenant_id = $1 and number = $2", [tenant, num6])).rows[0];
  expect(inv6?.status).toBe("paid");
  workerOnce(tenant, at.plus({ minutes: 5 }));
  await expect.poll(async () => (await messagesTo(DOMAIN)).filter((m) => m.Subject.startsWith("Payment received")).length, { timeout: 60_000 }).toBe(1);
  const reminders6 = (await db().query<{ n: number }>("select count(*)::int as n from public.messages m join public.message_invoices mi on mi.message_id = m.id where mi.invoice_id = $1 and m.purpose = 'reminder' and m.created_at > $2", [inv6?.id, at.toJSDate()])).rows[0]?.n;
  record("6", `${num6}: pay link from the real email -> Pay -> signed webhook -> paid; exactly one receipt; no new reminders (${reminders6})`, true);

  // ---- Kill switch mid-run and opt-out via the footer link: silence ----------------------------------------------
  await clearMail();
  const optPage = await context.newPage();
  await optPage.goto(optUrl ?? "");
  await optPage.getByRole("button", { name: "Stop messages" }).click();
  await expect(optPage.getByRole("status")).toContainText("You will not receive further reminders");
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Type PAUSE to confirm").fill("PAUSE");
  await page.getByRole("button", { name: "Pause all sending" }).click();
  await expect(page.getByTestId("paused-banner")).toBeVisible();
  const later = at.plus({ days: 8 }).set({ hour: 11 });
  workerOnce(tenant, later);
  await db().query("update public.approvals set status = 'approved', decided_at = now(), decided_by = 'e2e' where tenant_id = $1 and status = 'pending'", [tenant]);
  workerOnce(tenant, later);
  expect((await messagesTo(DOMAIN)).length).toBe(0);
  record("extra", "kill switch on: zero sends", true);
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Type RESUME to confirm").fill("RESUME");
  await page.getByRole("button", { name: "Resume sending" }).click();
  workerOnce(tenant, later.plus({ hours: 1 }));
  await db().query("update public.approvals set status = 'approved', decided_at = now(), decided_by = 'e2e' where tenant_id = $1 and status = 'pending'", [tenant]);
  workerOnce(tenant, later.plus({ hours: 1 }));
  const toOptedOut = (await messagesTo(DOMAIN)).filter((m) => m.To.some((t) => t.Address === `c${third}${DOMAIN}`)).length;
  expect(toOptedOut).toBe(0);
  record("extra", `opt-out through the footer link: no further messages to c${third}`, true);

  // ---- Step 7: KPIs equal values computed from the fixture; CSV export; integrity --------------------------------
  const paidMinor = data.overdue.find((o) => o.number === num6)?.minor ?? 0;
  await page.goto("/?period=this_month");
  const recovered = (await page.getByTestId("kpi-recovered").innerText()).replace(/\s/g, "");
  expect(recovered).toContain(`£${(paidMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
  const overdueTxt = await page.getByTestId("kpi-overdue").innerText();
  expect(overdueTxt).toContain("11 invoices"); // 12 overdue - 1 paid
  const download = page.waitForEvent("download");
  await page.goto("/invoices");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const { readFileSync } = await import("node:fs");
  const exported = readFileSync(await (await download).path(), "utf8");
  expect(exported.trim().split(/\r\n/).length).toBe(41);
  const ig = integrity();
  expect(ig.code, ig.out).toBe(0);
  record("7", `KPIs match the fixture (recovered £${(paidMinor / 100).toFixed(2)}, 11 overdue); export has 40 rows; payments:integrity clean`, true);

  console.log("\nE2E DEMO RESULTS");
  console.table(table);
  expect(BASE_URL).toContain("localhost");
});
