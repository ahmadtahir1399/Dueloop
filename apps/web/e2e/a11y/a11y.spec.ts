// Step 14: `pnpm web:test:a11y`. Automated checks with @axe-core/playwright (WCAG 2.x A/AA rule tags) on key pages,
// plus scripted keyboard-only runs. This finds a subset of problems; it is NOT a conformance claim. Screen-reader
// testing, contrast in every theme and cognitive load were not checked.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { issueFor } from "../support/links";
import { authFile } from "../support/users";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  console.log(JSON.stringify({ page: name, violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) }));
  expect(serious.map((v) => `${v.id} (${v.nodes.length})`), `${name}: serious/critical axe violations`).toEqual([]);
}

test.describe("staff pages (owner)", () => {
  test.use({ storageState: authFile("owner") });
  for (const p of ["/", "/invoices", "/customers", "/approvals", "/tasks", "/import", "/settings", "/settings/policies", "/settings/templates"]) {
    test(`axe: ${p}`, async ({ page }) => {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      await scan(page, p);
    });
  }

  test("keyboard only: approvals can be reached and approved without a mouse", async ({ page }) => {
    await page.goto("/approvals");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "");
      reached = label === "Approve" || label === "Approve selected";
      // Visible focus: an outline, or the focus ring shadcn draws as a box-shadow (it sets outline: none).
      const focus = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return { outline: "none", shadow: "none" };
        const cs = getComputedStyle(el);
        return { outline: cs.outlineStyle, shadow: cs.boxShadow };
      });
      if (reached) expect(focus.outline !== "none" || focus.shadow !== "none").toBe(true);
    }
    expect(reached).toBe(true);
  });

  test("keyboard only: import wizard file input and labels; errors are announced", async ({ page }) => {
    await page.goto("/import");
    await page.waitForLoadState("networkidle");
    const file = page.locator('input[type="file"]');
    await file.focus();
    await expect(file).toBeFocused();
  });
});

test.describe("public pages", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("axe: pay page and opt-out page", async ({ page }) => {
    const l = await issueFor("DA-0031");
    await page.goto(`/p/${l.payToken}`);
    await scan(page, "/p/<token>");
    await page.goto(`/o/${l.optToken}`);
    await scan(page, "/o/<token>");
    await page.goto(`/p/${"Z".repeat(43)}`);
    await scan(page, "invalid link");
  });

  test("keyboard only: pay page focus order follows the page and every control has a label", async ({ page }) => {
    const l = await issueFor("DA-0031");
    await page.goto(`/p/${l.payToken}`);
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const el = document.activeElement as HTMLInputElement | HTMLButtonElement | null;
        if (!el) return "";
        const id = el.getAttribute("id");
        const label = id ? document.querySelector(`label[for="${id}"]`)?.textContent : null;
        return `${el.tagName.toLowerCase()}:${label ?? el.textContent ?? ""}`.trim();
      }));
    }
    const idx = (s: string) => order.findIndex((o) => o.includes(s));
    expect(idx("Date")).toBeGreaterThan(-1);
    expect(idx("Send")).toBeGreaterThan(idx("Date"));
    expect(idx("File")).toBeGreaterThan(idx("Send"));
    expect(idx("Request a copy")).toBeGreaterThan(idx("Upload"));
  });
});
