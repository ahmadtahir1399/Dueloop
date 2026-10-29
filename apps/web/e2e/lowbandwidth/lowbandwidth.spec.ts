// Step 14: `pnpm web:test:lowbandwidth`. A throttled mobile profile (Pixel 7 device descriptor + CDP network
// emulation; Network.emulateNetworkConditions is marked deprecated in the protocol in favour of a by-rule variant,
// but is still supported by the installed Chromium) and JavaScript DISABLED. Page weights are measured from the
// responses actually transferred and checked against budgets. Numbers are printed; nothing is extrapolated.
import { expect, test, type Page } from "@playwright/test";
import { db } from "../support/db";
import { issueFor, makeOverdue } from "../support/links";

/** Budgets in bytes on the wire (encoded). */
export const BUDGET = { payPage: 20 * 1024, optOutPage: 12 * 1024 } as const;
/** "Slow 3G"-like: 400 ms RTT, 50 KB/s down, 20 KB/s up. */
const SLOW = { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 };

test.use({ storageState: { cookies: [], origins: [] }, javaScriptEnabled: false });

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", SLOW);
}

async function measure(page: Page, url: string) {
  let bytes = 0;
  const urls: string[] = [];
  page.on("response", async (r) => {
    const len = Number((await r.allHeaders())["content-length"] ?? "NaN");
    const body = Number.isFinite(len) ? len : (await r.body().catch(() => Buffer.alloc(0))).length;
    bytes += body;
    urls.push(new URL(r.url()).pathname.replace(/\/[A-Za-z0-9_-]{43}/, "/<token>"));
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load" });
  return { bytes, ms: Date.now() - t0, requests: urls.length, urls };
}

test("pay page: weight and time on a throttled mobile connection, no JavaScript", async ({ page }) => {
  await throttle(page);
  const l = await issueFor("DA-0032");
  const m = await measure(page, `/p/${l.payToken}`);
  console.log(JSON.stringify({ page: "pay", ...m, budget: BUDGET.payPage }));
  expect(m.bytes).toBeLessThanOrEqual(BUDGET.payPage);
  expect(m.urls.some((u) => u.includes("/_next/"))).toBe(false); // no framework JavaScript on the public page
});

test("opt-out page weight", async ({ page }) => {
  await throttle(page);
  const l = await issueFor("DA-0032");
  const m = await measure(page, `/o/${l.optToken}`);
  console.log(JSON.stringify({ page: "opt-out", ...m, budget: BUDGET.optOutPage }));
  expect(m.bytes).toBeLessThanOrEqual(BUDGET.optOutPage);
});

test("pay and opt-out flows work with JavaScript disabled on a slow connection", async ({ page }) => {
  await throttle(page);
  const l = await issueFor("DA-0033");
  await makeOverdue(l.invoiceId);
  await page.goto(`/p/${l.payToken}`);
  await page.getByLabel("Date").fill(new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status")).toHaveText(/noted it|review it/);
  await page.goto(`/o/${l.optToken}`);
  await page.getByRole("button", { name: "Stop messages" }).click();
  await expect(page.getByRole("status")).toContainText("You will not receive further reminders");
  expect((await db().query("select opted_out from public.customers where id = $1", [l.customerId])).rows[0].opted_out).toBe(true);
});
