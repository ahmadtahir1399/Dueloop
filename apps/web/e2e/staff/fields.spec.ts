// D22 (redesign §7.3): the shadcn Select works by keyboard (Enter / Space / ArrowDown open it, typeahead moves,
// Escape closes and focus returns to the trigger), the searchable Combobox does too, and axe finds no serious or
// critical issue in the forms that use them. Runs against the production build (playwright.config.ts).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { authFile } from "../support/users";

test.use({ storageState: authFile("owner") });

async function axeForms(page: Page) {
  const r = await new AxeBuilder({ page }).include("form").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("Select: keyboard open, typeahead, pick, Escape returns focus (invoice filter)", async ({ page }) => {
  await page.goto("/invoices");
  const trigger = page.getByRole("combobox", { name: "Status" });
  const listbox = page.getByRole("listbox");
  for (const key of ["Enter", " ", "ArrowDown"]) {
    await trigger.focus();
    await page.keyboard.press(key);
    await expect(listbox, `opens with ${JSON.stringify(key)}`).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(listbox).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(listbox).toBeVisible();
  await page.keyboard.type("Pro");
  await expect(listbox.locator("[data-highlighted]")).toHaveText("Promised");
  await page.keyboard.press("Enter");
  await expect(listbox).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toContainText("Promised");
  // The value still posts through the same hidden field as before (payload unchanged, D10).
  await expect(page.locator('input[type="hidden"][name="status"]')).toHaveValue("promised");
});

test("Combobox: search, arrows, Enter picks, Escape returns focus (settings time zone)", async ({ page }) => {
  await page.goto("/settings");
  const form = page.getByRole("form", { name: "Change settings" });
  const trigger = form.getByLabel("Time zone");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const search = page.getByRole("combobox", { name: "Search time zones" });
  await expect(search).toBeFocused();
  await page.keyboard.type("karachi");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).toContainText("Asia/Karachi");
  await expect(form.locator('input[type="hidden"][name="timezone"]')).toHaveValue("Asia/Karachi");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

for (const path of ["/invoices", "/settings", "/customers"]) {
  test(`axe: no serious or critical issue in the forms on ${path}`, async ({ page }) => {
    await page.goto(path);
    expect(await axeForms(page)).toEqual([]);
  });
}
