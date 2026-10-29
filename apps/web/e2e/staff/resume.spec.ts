// A parked invoice could only be resumed with `pnpm messages unpark` (setup-flow review, round 1), so an invoice
// parked before setup was finished stayed stuck for a web-only user. Now: "Resume reminders" on the invoice page,
// owner and accountant only, never for an unknown-state message (rule 17: a human reconciles it on Unknown sends)
// or a pending approval. It only reschedules; the worker still runs decide() and every gate (rule 40).
import { expect, test } from "@playwright/test";
import { db } from "../support/db";
import { authFile, DEMO_TENANT } from "../support/users";

async function parkedInvoice(number: string, reason: string): Promise<string> {
  const r = await db().query("update public.invoices set next_action_at = 'infinity', parked_reason = $3, enqueued_at = null where tenant_id = $1 and number = $2 returning id", [DEMO_TENANT, number, reason]);
  return r.rows[0].id as string;
}
const state = async (id: string) => (await db().query("select parked_reason, next_action_at <= now() as due from public.invoices where id = $1", [id])).rows[0];

test.describe("accountant", () => {
  test.use({ storageState: authFile("accountant") });

  test("resumes an invoice parked for a missing template", async ({ page }) => {
    const id = await parkedInvoice("DA-0010", "template_missing");
    await page.goto(`/invoices/${id}`);
    const form = page.getByRole("form", { name: "Resume reminders" });
    await form.getByRole("button", { name: "Resume reminders" }).click();
    await expect(page.getByRole("form", { name: "Resume reminders" })).toHaveCount(0);
    expect(await state(id)).toEqual({ parked_reason: null, due: true });
  });

  test("an unknown-state message is never resumed from here (rule 17)", async ({ page }) => {
    const id = await parkedInvoice("DA-0011", "message_unknown");
    try {
      await page.goto(`/invoices/${id}`);
      await expect(page.getByRole("form", { name: "Resume reminders" })).toHaveCount(0);
      await expect(page.getByText("Unknown sends")).not.toHaveCount(0);
      expect((await state(id)).parked_reason).toBe("message_unknown");
    } finally {
      await db().query("update public.invoices set parked_reason = null, next_action_at = now() + interval '1 day' where id = $1", [id]);
    }
  });
});

test.describe("collector", () => {
  test.use({ storageState: authFile("collector") });

  test("sees why it is parked but has no resume button", async ({ page }) => {
    const id = await parkedInvoice("DA-0010", "budget_exhausted");
    try {
      await page.goto(`/invoices/${id}`);
      await expect(page.getByText("budget_exhausted", { exact: true })).toBeVisible();
      await expect(page.getByRole("form", { name: "Resume reminders" })).toHaveCount(0);
    } finally {
      await db().query("update public.invoices set parked_reason = null, next_action_at = now() + interval '1 day' where id = $1", [id]);
    }
  });
});
