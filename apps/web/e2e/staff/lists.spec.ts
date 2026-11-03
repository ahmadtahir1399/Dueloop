// D25 (redesign §4.10): filters apply by themselves. No Apply button; a select applies at once; search applies once
// per 300 ms burst; the URL carries the filters; leaving the list and pressing Back restores them (filter changes use
// router.replace, so they do not add history entries of their own, C-54); the page does not jump to the top; a polite
// live region states the count. Runs against the production build (playwright.config.ts).
import { expect, test, type Page } from "@playwright/test";
import { choose } from "../support/choice";
import { authFile } from "../support/users";

test.use({ storageState: authFile("owner") });

const noApplyButtons = async (page: Page) => {
  const bar = page.getByRole("search");
  await expect(bar.getByRole("button", { name: /^(Apply|Apply filters|Filter|Search|Show|Go)$/ })).toHaveCount(0);
};

/** Leave the list for another page, then press Back: the list comes back with its filters. */
async function backRestores(page: Page, url: RegExp) {
  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page).toHaveURL(/\/settings/);
  await page.goBack();
  await expect(page).toHaveURL(url);
}

test("invoices: select, search burst, chips, count, scroll and Back (D25)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/overview");
  await page.getByRole("link", { name: "Invoices" }).first().click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.getByTestId("invoice-table").locator("tbody tr").first()).toBeVisible();
  await noApplyButtons(page);

  const rscQueries: string[] = [];
  page.on("request", (r) => {
    if (r.headers()["rsc"] === "1" && new URL(r.url()).pathname === "/invoices") rscQueries.push(new URL(r.url()).search);
  });

  // A select applies at once, keeps the scroll position, and the rows follow within 1 s.
  await page.evaluate(() => window.scrollTo(0, 120));
  const y0 = await page.evaluate(() => window.scrollY);
  expect(y0).toBe(120);
  await choose(page.getByRole("combobox", { name: "Status" }), "Overdue");
  await expect(page).toHaveURL(/status=overdue/, { timeout: 1000 });
  const status = page.getByTestId("invoice-table").locator("tbody tr td:nth-child(3)");
  await expect.poll(async () => (await status.allInnerTexts()).every((t) => t.trim() === "Overdue"), { timeout: 1000 }).toBe(true);
  const y1 = await page.evaluate(() => window.scrollY);
  const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(y1).toBe(Math.min(y0, max)); // no jump to the top (only clamped if the page got shorter)
  await expect(page.getByTestId("list-count")).toHaveText(/\d+ invoices?|No invoices match/);
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Overdue");

  // Typing: one request for the whole burst (300 ms debounce), not one per key.
  rscQueries.length = 0;
  await page.getByLabel("Search", { exact: true }).pressSequentially("DA-00", { delay: 40 });
  await expect(page).toHaveURL(/q=DA-00/);
  await page.waitForTimeout(500);
  expect(rscQueries.filter((q) => q.includes("q="))).toHaveLength(1);
  for (const t of await page.getByTestId("invoice-table").locator("tbody tr td:nth-child(1)").allInnerTexts()) expect(t).toContain("DA-00");

  // Back (after leaving the list) restores filters, controls and results.
  await backRestores(page, /status=overdue.*q=DA-00|q=DA-00.*status=overdue/);
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveText("Overdue");
  await expect(page.getByLabel("Search", { exact: true })).toHaveValue("DA-00");
  for (const t of await status.allInnerTexts()) expect(t.trim()).toBe("Overdue");

  // A chip removes its one filter; Escape clears the search at once.
  await page.getByRole("button", { name: "Remove filter: Overdue" }).click();
  await expect(page).not.toHaveURL(/status=/);
  await expect(page).toHaveURL(/q=DA-00/);
  await page.getByLabel("Search", { exact: true }).press("Escape");
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.getByRole("list", { name: "Active filters" })).toHaveCount(0);
});

test("customers: checkbox applies at once; Back restores it (D25)", async ({ page }) => {
  await page.goto("/customers");
  await noApplyButtons(page);
  await page.getByRole("checkbox", { name: "Opted out only" }).check();
  await expect(page).toHaveURL(/opted_out=1/, { timeout: 1000 });
  await expect(page.getByTestId("list-count")).toHaveText(/customer/);
  await backRestores(page, /opted_out=1/);
  await expect(page.getByRole("checkbox", { name: "Opted out only" })).toBeChecked();
});

for (const [path, label, tab, param] of [
  ["/tasks", "Task status", "Resolved", /status=resolved/],
  ["/proofs", "Proof status", "Confirmed", /status=confirmed/],
] as const) {
  test(`${path}: status tab applies in place; Back restores it (D25)`, async ({ page }) => {
    await page.goto(path);
    await page.getByRole("navigation", { name: label }).getByRole("link", { name: tab }).click();
    await expect(page).toHaveURL(param, { timeout: 1000 });
    await expect(page.getByRole("navigation", { name: label }).getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
    await backRestores(page, param);
    await expect(page.getByRole("navigation", { name: label }).getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
  });
}

test("overview: period applies on change; Back restores it (D25)", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.getByRole("button", { name: "Show" })).toHaveCount(0);
  await choose(page.getByRole("combobox", { name: "Period" }), "Last 30 days");
  await expect(page).toHaveURL(/period=last_30/, { timeout: 1000 });
  await backRestores(page, /period=last_30/);
  await expect(page.getByRole("combobox", { name: "Period" })).toHaveText("Last 30 days");
});

test("bad filter values fall back instead of failing", async ({ page }) => {
  const res = await page.goto("/invoices?status=bogus&bucket=%3Cx%3E&customer=nope&q=" + "x".repeat(300));
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveText("Any");
});
