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

test("Combobox: name + value exposed; search, arrows, Enter picks; Escape and Tab return focus (settings time zone)", async ({ page }) => {
  await page.goto("/settings");
  const form = page.getByRole("form", { name: "Change settings" });
  // role=combobox: the name is the field label and the chosen zone is its value (WCAG 4.1.2).
  const trigger = form.getByRole("combobox", { name: "Time zone", exact: true });
  await expect(trigger).toHaveText("Europe/London");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("dialog", { name: "Search time zones" })).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search time zones" });
  await expect(search).toBeFocused();
  await page.keyboard.type("tokyo");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Home"); // Home/End stay with the text box
  await expect(search).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).toHaveText("Asia/Tokyo");
  await expect(trigger).toBeFocused();
  await expect(form.locator('input[type="hidden"][name="timezone"]')).toHaveValue("Asia/Tokyo");
  // No match: a status message, and no empty listbox.
  await page.keyboard.press("Enter");
  await search.fill("Mars/Olympus");
  await expect(page.getByRole("dialog", { name: "Search time zones" }).getByRole("status")).toContainText("No matches");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  // Tab from the search box closes the list and returns focus to the trigger.
  await page.keyboard.press("Enter");
  await expect(search).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog", { name: "Search time zones" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("36 px fields keep a 44 px hit area (header search, overview period select)", async ({ page }) => {
  await page.goto("/overview");
  const search = page.locator("#shell-search");
  const hit = page.locator('[data-slot="input-hit"]').filter({ has: search });
  const box = await hit.boundingBox();
  const field = await search.boundingBox();
  expect(field && Math.round(field.height)).toBe(36);
  expect(box && box.height).toBeGreaterThanOrEqual(44);
  // A click 2 px above the visible field (inside the hit area) focuses it.
  if (!field) throw new Error("no search box");
  await page.mouse.click(field.x + field.width / 2, field.y - 2);
  await expect(search).toBeFocused();

  const period = page.getByRole("combobox", { name: "Period" });
  const pb = await period.boundingBox();
  if (!pb) throw new Error("no period select");
  expect(Math.round(pb.height)).toBe(36);
  const hitHeight = await period.evaluate((el) => parseFloat(getComputedStyle(el, "::after").height));
  expect(hitHeight).toBeGreaterThanOrEqual(44);
  await page.mouse.click(pb.x + pb.width / 2, pb.y - 3);
  await expect(page.getByRole("listbox")).toBeVisible();
});

for (const path of ["/invoices", "/settings", "/customers"]) {
  test(`axe: no serious or critical issue in the forms on ${path}`, async ({ page }) => {
    await page.goto(path);
    expect(await axeForms(page)).toEqual([]);
  });
}
