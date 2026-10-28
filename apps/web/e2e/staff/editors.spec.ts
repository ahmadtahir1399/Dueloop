// Step 10: editors per role (issues K, L, M, N, O).
import { expect, test } from "@playwright/test";
import { db } from "../support/db";
import { authFile, DEMO_TENANT } from "../support/users";

test.describe("accountant", () => {
  test.use({ storageState: authFile("accountant") });

  test("K: policy edit keeps step ids, shows impact and the decide() preview before saving", async ({ page }) => {
    const before = (await db().query("select id, steps from public.policies where tenant_id = $1 and is_default", [DEMO_TENANT])).rows[0];
    await page.goto("/settings/policies");
    const form = page.getByRole("form", { name: /Policy/ }).first();
    await form.getByLabel("Days after due for s1").fill("2");
    await form.getByRole("button", { name: "Save policy" }).isDisabled();
    await form.getByRole("button", { name: "Check impact" }).click();
    const impact = page.getByTestId("policy-impact");
    await expect(impact).toContainText("open invoices use this policy");
    await impact.getByLabel("I checked the impact").check();
    await page.getByRole("button", { name: "Save policy" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    const after = (await db().query("select steps from public.policies where id = $1", [before.id])).rows[0].steps as { id: string; daysAfterDue: number }[];
    expect(after.map((s) => s.id)).toEqual((before.steps as { id: string }[]).map((s) => s.id));
    expect(after.find((s) => s.id === "s1")?.daysAfterDue).toBe(2);
  });

  test("L: template preview uses the real renderer, warns on threatening wording, footer is read-only", async ({ page }) => {
    await page.goto("/settings/templates");
    const card = page.locator('[data-template="friendly:email"]');
    await card.getByLabel(/Body/).fill("Hello {{customer_name}}. We may take legal action. {{payment_block}}");
    await card.getByRole("button", { name: "Preview" }).click();
    await expect(card.getByTestId("template-preview")).toContainText("Sample Customer Ltd");
    await expect(card.getByTestId("template-preview")).toContainText("To stop these reminders");
    await expect(card.getByTestId("wording-warning")).toContainText("legal action");
    await card.getByLabel(/Body/).fill("Hello {{unknown_var}}");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("alert")).toContainText("does not render");
  });

  test("L: editing the WhatsApp template body requires resubmission and blocks it until an owner confirms", async ({ page }) => {
    await page.goto("/settings/templates");
    const card = page.locator('[data-template="nudge:whatsapp"]');
    await card.getByLabel(/Body/).fill("Hello {{customer_name}}, invoice {{invoice_number}} is due. {{business_name}}");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(card.getByRole("status").filter({ hasText: "submitted to Meta again" })).toBeVisible();
    const t = await db().query("select provider_status from public.templates where tenant_id = $1 and template_key = 'nudge' and channel = 'whatsapp'", [DEMO_TENANT]);
    expect(t.rows[0].provider_status).toBe("needs_resubmission");
    await expect(page.getByRole("button", { name: "Meta approved this text" })).toHaveCount(0); // accountant cannot
  });

  test("settings and members are read-only for an accountant", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("form", { name: "Change settings" })).toHaveCount(0);
    await page.goto("/settings/members");
    await expect(page.getByRole("button", { name: "Change role" })).toHaveCount(0);
    await page.goto("/settings/api-keys");
    await expect(page.getByText("This page does not exist, or you do not have access to it.")).toBeVisible();
  });
});

test.describe("owner", () => {
  test.use({ storageState: authFile("owner") });

  test("settings are validated by core (bad zone refused); holidays add and remove", async ({ page }) => {
    await page.goto("/settings");
    const f = page.getByRole("form", { name: "Change settings" });
    await f.getByLabel(/Time zone/).fill("GMT+5");
    await f.getByRole("button", { name: "Save settings" }).click();
    await expect(f.getByRole("alert")).toContainText("IANA");
    await page.goto("/settings/holidays");
    await page.getByLabel("Date").fill("2026-12-26");
    await page.getByLabel("Label").fill("Boxing Day <b>x</b>");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByTestId("holiday-list")).toContainText("Boxing Day <b>x</b>");
  });

  test("M: the last owner cannot be demoted; roles change for others", async ({ page }) => {
    // Demo Agency has two owners (seed + e2e). Demote the seed owner first so e2e owner is the last one.
    await page.goto("/settings/members");
    const seedOwner = page.locator('[data-member="owner@demo-agency.test"]');
    await seedOwner.getByLabel(/Role of/).selectOption("accountant");
    await seedOwner.getByRole("button", { name: "Change role" }).click();
    await expect(seedOwner.getByRole("status")).toContainText("Saved");
    const me = page.locator('[data-member="owner@e2e.test"]');
    await me.getByLabel(/Role of/).selectOption("collector");
    await me.getByRole("button", { name: "Change role" }).click();
    await expect(me.getByRole("alert")).toContainText("at least one owner");
    const owners = await db().query("select count(*)::int as n from public.memberships where tenant_id = $1 and role = 'owner'", [DEMO_TENANT]);
    expect(owners.rows[0].n).toBe(1);
  });

  test("O/N: an API key is shown once; secrets are write-only and never in the page", async ({ page }) => {
    await page.goto("/settings/api-keys");
    await page.getByLabel("Name").fill("ERP sync");
    await page.getByRole("button", { name: "Create key" }).click();
    const secret = (await page.getByTestId("secret-once").locator("code").innerText()).trim();
    expect(secret).toMatch(/^dl_[a-z0-9]{8}_/);
    await page.reload();
    expect(await page.content()).not.toContain(secret.split("_")[2]);
    await expect(page.getByTestId("key-list")).toContainText("ERP sync");

    await page.goto("/settings/integrations");
    const form = page.getByRole("form", { name: "Set channel credentials" });
    await form.getByLabel("Secret").fill("smtp-password-e2e-0001");
    await form.getByRole("button", { name: "Save secret" }).click();
    await expect(form.getByRole("status")).toContainText("cannot be shown again");
    await page.reload();
    expect(await page.content()).not.toContain("smtp-password-e2e-0001");
    await expect(page.locator('[data-channel="email"]')).toContainText("credentials set");
  });
});
