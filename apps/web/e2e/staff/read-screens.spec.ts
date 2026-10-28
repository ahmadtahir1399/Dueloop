// Step 3: read screens, hostile fixtures rendered as inert text (issue G), tenant-zone times (J), money (I).
import { expect, test } from "@playwright/test";
import { HOSTILE } from "../support/fixtures";
import { guardAgainstScript } from "../support/guard";
import { authFile, fixtureIds } from "../support/users";

test.use({ storageState: authFile("owner") });

test("overview: KPI cards, ageing chart with a table alternative, local-day period", async ({ page }) => {
  await page.goto("/");
  for (const id of ["kpi-overdue", "kpi-recovered", "kpi-promise", "kpi-days", "kpi-messages"]) await expect(page.getByTestId(id)).toBeVisible();
  const table = page.getByRole("table", { name: /Open balances by age, GBP/ });
  await expect(table).toBeVisible();
  await expect(table.getByRole("rowheader", { name: "1-30 days overdue" })).toBeVisible();
  await expect(page.getByTestId("period-range")).toContainText("Europe/London");
  await page.getByLabel("Period").selectOption("last_30");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/period=last_30/);
});

test("invoices: filter, keyset pages, detail with timeline in the tenant zone", async ({ page }) => {
  await page.goto("/invoices?status=overdue");
  const rows = page.getByTestId("invoice-table").locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  for (const s of await rows.locator("td:nth-child(3)").allInnerTexts()) expect(s.trim()).toBe("overdue");
  await page.getByRole("link", { name: "DA-0001" }).click();
  await expect(page.getByTestId("balance")).toContainText("£");
  await expect(page.getByTestId("timeline").locator("li").first()).toBeVisible();
  await expect(page.getByText("Times are in Europe/London.")).toBeVisible();
});

test("invoices: search is sanitised and keyset paging returns distinct rows", async ({ page }) => {
  await page.goto("/invoices?q=" + encodeURIComponent("DA-00%'),or(id.gt.0"));
  await expect(page.locator("main")).toBeVisible(); // no error page: the junk is stripped
  await page.goto("/invoices");
  const first = await page.getByTestId("invoice-table").locator("tbody tr").allInnerTexts();
  const next = page.getByRole("link", { name: "Next page" });
  if (await next.count()) {
    await next.click();
    const second = await page.getByTestId("invoice-table").locator("tbody tr").allInnerTexts();
    expect(second.filter((r) => first.includes(r))).toEqual([]);
  }
});

test("hostile fixtures render as text everywhere (no script, no markup)", async ({ page }) => {
  const f = await fixtureIds();
  const guard = guardAgainstScript(page);
  await page.goto("/customers");
  await expect(page.getByText(HOSTILE.img, { exact: false }).first()).toBeVisible();
  await page.goto(`/customers/${f.hostileCustomer}`);
  await expect(page.locator("h1")).toContainText("<img src=x");
  await expect(page.locator('h1 [dir="auto"]')).toHaveCount(1);
  await page.goto(`/invoices/${f.hostileInvoice}`);
  await expect(page.locator("h1")).toContainText("X-<script>1</script>");
  await expect(page.getByText(HOSTILE.urdu)).toBeVisible();
  await expect(page.locator('[data-ai-untrusted="true"]').first()).toContainText("AI-generated, untrusted");
  await page.goto("/inbox");
  await page.getByTestId("inbox-table").getByRole("link").first().click();
  await expect(page.getByText('"><img src=x onerror=alert(1)>.pdf')).toBeVisible();
  // javascript: text is never a link.
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await page.goto(`/tasks/${f.tasks["e2e-claim"]}`);
  await expect(page.getByRole("textbox", { name: "Suggested reply" })).toHaveValue(/<script>/);
  await page.goto(`/proofs/${f.proofs.ui}`);
  await expect(page.getByText('"><svg onload=alert(1)>.png')).toBeVisible();
  await expect(page.getByText('<script>window.__pwned=1;alert("x")</script>')).toBeVisible();
  await guard.check();
});
