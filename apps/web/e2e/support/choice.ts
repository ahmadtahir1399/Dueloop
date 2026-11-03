// The redesign replaced native <select>s with a custom listbox (components/ui/choice-select.tsx), so Playwright's
// selectOption() no longer applies. This opens the listbox from its trigger and picks an option by name or index.
import { expect, type Locator } from "@playwright/test";

export async function choose(trigger: Locator, option: string | RegExp | { index: number }): Promise<void> {
  await trigger.click();
  const page = trigger.page();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const target =
    typeof option === "object" && !(option instanceof RegExp)
      ? listbox.getByRole("option").nth(option.index)
      : listbox.getByRole("option", { name: option, exact: typeof option === "string" });
  await target.click();
  await expect(listbox).toHaveCount(0);
}
