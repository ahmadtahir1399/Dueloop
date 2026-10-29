// WhatsApp needs a recorded consent (router: no_consent skips the step), but nothing in the UI could record one
// (setup-flow review, round 1). Owners and accountants record and withdraw it on the customer page; RLS
// (customer_consents I/U for owner/accountant) is the database check.
import { expect, test } from "@playwright/test";
import { db } from "../support/db";
import { authFile, DEMO_TENANT } from "../support/users";

const customer = async (name: string) => (await db().query("select id from public.customers where tenant_id = $1 and display_name = $2", [DEMO_TENANT, name])).rows[0].id as string;
const active = async (id: string) => (await db().query("select source from public.customer_consents where tenant_id = $1 and customer_id = $2 and channel = 'whatsapp' and revoked_at is null", [DEMO_TENANT, id])).rows;

test.describe("accountant", () => {
  test.use({ storageState: authFile("accountant") });

  test("records a WhatsApp consent with its source, then withdraws it", async ({ page }) => {
    const id = await customer("Imran Textiles");
    await db().query("update public.customer_consents set revoked_at = now() where tenant_id = $1 and customer_id = $2 and revoked_at is null", [DEMO_TENANT, id]);
    await page.goto(`/customers/${id}`);
    const form = page.getByRole("form", { name: "Record consent" });
    await form.getByLabel("Channel").selectOption("whatsapp");
    await form.getByRole("button", { name: "Record consent" }).click();
    await expect(form.getByRole("alert")).toContainText("Say how");
    await form.getByLabel(/How did they agree/).fill("Signed order form, 2 March");
    await form.getByRole("button", { name: "Record consent" }).click();
    await expect(page.getByTestId("consent-list")).toContainText("Signed order form, 2 March");
    expect(await active(id)).toEqual([{ source: "Signed order form, 2 March" }]);

    await page.getByRole("form", { name: "Withdraw whatsapp consent" }).getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByRole("form", { name: "Withdraw whatsapp consent" })).toHaveCount(0);
    expect(await active(id)).toEqual([]);
  });
});

test.describe("collector", () => {
  test.use({ storageState: authFile("collector") });

  test("sees consents but cannot record or withdraw them", async ({ page }) => {
    await page.goto(`/customers/${await customer("Imran Textiles")}`);
    await expect(page.getByTestId("consent-list")).toBeVisible();
    await expect(page.getByRole("form", { name: "Record consent" })).toHaveCount(0);
  });
});
