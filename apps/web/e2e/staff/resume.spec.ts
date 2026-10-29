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

test.describe("accountant: retries and ambiguous sends", () => {
  test.use({ storageState: authFile("accountant") });

  async function messageFor(invoiceId: string, state: string, attempt: number, key: string): Promise<string> {
    const inv = (await db().query("select customer_id from public.invoices where id = $1", [invoiceId])).rows[0];
    const m = (await db().query("insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key, send_state, attempt) values ($1, $2, 'email', 'out', $3, $4, $5) returning id", [DEMO_TENANT, inv.customer_id, key, state, attempt])).rows[0];
    await db().query("insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)", [DEMO_TENANT, m.id, invoiceId]);
    return m.id as string;
  }

  test("a dead-lettered invoice resumes with its retry counter reset (a retry was provably not sent)", async ({ page }) => {
    const id = await parkedInvoice("DA-0005", "dead_letter");
    const msg = await messageFor(id, "retry", 5, `e2e-resume-dl-${Date.now()}`);
    await page.goto(`/invoices/${id}`);
    await page.getByRole("form", { name: "Resume reminders" }).getByRole("button", { name: "Resume reminders" }).click();
    await expect(page.getByRole("form", { name: "Resume reminders" })).toHaveCount(0);
    expect(await state(id)).toEqual({ parked_reason: null, due: true });
    expect((await db().query("select attempt from public.messages where id = $1", [msg])).rows[0].attempt).toBe(0);
  });

  test("an ambiguous send (message still pending) can never be resumed here (rule 17)", async ({ page }) => {
    const id = await parkedInvoice("DA-0007", "send_ambiguous");
    await messageFor(id, "pending", 1, `e2e-resume-amb-${Date.now()}`);
    try {
      await page.goto(`/invoices/${id}`);
      await expect(page.getByRole("form", { name: "Resume reminders" })).toHaveCount(0);
      expect((await state(id)).parked_reason).toBe("send_ambiguous");
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
