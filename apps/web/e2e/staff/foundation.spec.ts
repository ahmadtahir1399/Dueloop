// Step 1: authentication and tenant context (issue H).
import { expect, test } from "@playwright/test";
import { authFile, DEMO_TENANT, OTHER_TENANT } from "../support/users";

test.describe("signed out", () => {
  for (const path of ["/", "/invoices", "/customers", "/approvals", "/settings", "/import"]) {
    test(`redirects ${path} to /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    });
  }

  test("a forged auth cookie is not trusted", async ({ page, context }) => {
    const host = new URL(page.url() === "about:blank" ? "http://localhost:3100" : page.url()).hostname;
    await context.addCookies([
      { name: "sb-127-auth-token", value: "base64-eyJhY2Nlc3NfdG9rZW4iOiJmb3JnZWQifQ", domain: host, path: "/" },
    ]);
    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("no membership", () => {
  test.use({ storageState: authFile("nobody") });
  test("is sent to onboarding", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding$/);
  });
});

test.describe("tenant cookie", () => {
  test.use({ storageState: authFile("owner") });

  test("a tampered tenant cookie falls back to the user's own tenant", async ({ page, context }) => {
    await context.addCookies([{ name: "dl_tenant", value: OTHER_TENANT, domain: "localhost", path: "/" }]);
    await page.goto("/");
    await expect(page.getByText("Demo Agency").first()).toBeVisible();
    await expect(page.getByText("Isolation Test Co")).toHaveCount(0);
  });

  test("garbage in the tenant cookie is ignored", async ({ page, context }) => {
    await context.addCookies([{ name: "dl_tenant", value: "not-a-uuid%27%3B%20drop%20table%20x", domain: "localhost", path: "/" }]);
    await page.goto("/");
    await expect(page.getByText("Demo Agency").first()).toBeVisible();
  });
});

test.describe("multi-tenant user", () => {
  test.use({ storageState: authFile("multi") });

  test("switches between tenants and sees each one's role", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("whoami")).toContainText("collector");
    await page.getByLabel("Business").selectOption(OTHER_TENANT);
    await page.getByRole("button", { name: "Switch" }).click();
    await expect(page.getByTestId("whoami")).toContainText("accountant");
    await expect(page.getByText("Isolation Test Co").first()).toBeVisible();
    await page.getByLabel("Business").selectOption(DEMO_TENANT);
    await page.getByRole("button", { name: "Switch" }).click();
    await expect(page.getByTestId("whoami")).toContainText("collector");
  });

  test("role-aware nav: a collector does not see Import", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Import" })).toHaveCount(0);
  });
});
