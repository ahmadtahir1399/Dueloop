// Step 8: every screen allowed or denied per role, generated from the role matrix DATA (packages/authz), so the
// UI, these tests and ADR 0042 cannot drift apart.
import { can, type Role } from "@dueloop/authz";
import { expect, test } from "@playwright/test";
import { NAV } from "../../lib/nav";
import { authFile } from "../support/users";

for (const role of ["owner", "accountant", "collector"] as const satisfies readonly Role[]) {
  test.describe(`${role}: screens follow the matrix`, () => {
    test.use({ storageState: authFile(role) });
    for (const item of NAV) {
      const allowed = can(role, item.permission);
      test(`${item.href} is ${allowed ? "open" : "hidden and 404"}`, async ({ page }) => {
        await page.goto(item.href);
        const nav = page.getByRole("navigation", { name: "Main" });
        if (allowed) {
          await expect(page.getByText("This page does not exist, or you do not have access to it.")).toHaveCount(0);
          await expect(nav.getByRole("link", { name: new RegExp(`^${item.label}`) })).toBeVisible();
        } else {
          await expect(page.getByText("This page does not exist, or you do not have access to it.")).toBeVisible();
          await expect(nav.getByRole("link", { name: new RegExp(`^${item.label}`) })).toHaveCount(0);
        }
      });
    }
  });
}
