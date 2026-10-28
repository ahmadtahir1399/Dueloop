// Step 8, issue H: an owner of ANOTHER tenant submits Demo Agency ids to every page and every action. Pages answer
// 404; actions refuse; nothing in Demo Agency changes. Forms are taken from the outsider's own tenant and their
// hidden ids are swapped for Demo ids, exactly what a hostile user would do with devtools.
import { expect, test, type Page } from "@playwright/test";
import { db } from "../support/db";
import { authFile, DEMO_TENANT, fixtureIds } from "../support/users";

test.use({ storageState: authFile("outsider") });

// React restores controlled inputs to their prop value before it builds the form data, so setting .value is not
// enough: rename the real field and add a plain one carrying the foreign id (what a hostile user would do).
// The forged field goes BEFORE the original: if hydration later restores the original's name, the forged value is
// still the first one in the form data, which is the one the action reads.
async function swap(page: Page, name: string, value: string) {
  await page.waitForLoadState("networkidle");
  const n = await page.evaluate(
    ([n, v]) => {
      const els = Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${n}"]`));
      for (const el of els) {
        el.name = `${n}-original`;
        const forged = document.createElement("input");
        forged.type = "hidden";
        forged.name = n ?? "";
        forged.value = v ?? "";
        el.before(forged);
      }
      return els.length;
    },
    [name, value],
  );
  expect(n, `a "${name}" field to tamper with`).toBeGreaterThan(0);
}

async function demoState() {
  const r = await db().query(
    `select (select string_agg(status, ',' order by id) from public.approvals where tenant_id = $1) as a,
            (select string_agg(status, ',' order by id) from public.tasks where tenant_id = $1) as t,
            (select string_agg(coalesce(send_state, ''), ',' order by id) from public.messages where tenant_id = $1) as m,
            (select string_agg(status, ',' order by id) from public.promises where tenant_id = $1) as p,
            (select string_agg(status, ',' order by id) from public.payment_proofs where tenant_id = $1) as pr,
            (select count(*) from public.receipts where tenant_id = $1) as rc`,
    [DEMO_TENANT],
  );
  return r.rows[0];
}

test("Demo Agency pages answer 404 to an outsider", async ({ page }) => {
  const f = await fixtureIds();
  const demoInvoice = (await db().query("select id, customer_id from public.invoices where tenant_id = $1 and number = 'DA-0001'", [DEMO_TENANT])).rows[0];
  for (const url of [
    `/invoices/${demoInvoice.id}`,
    `/customers/${demoInvoice.customer_id}`,
    `/tasks/${f.tasks["e2e-claim"]}`,
    `/proofs/${f.proofs.cli}`,
    `/inbox/${demoInvoice.customer_id}/email`,
    `/payments/new?invoice=${demoInvoice.id}`,
  ]) {
    await page.goto(url);
    await expect(page.getByText("This page does not exist, or you do not have access to it."), url).toBeVisible();
  }
  const file = await page.request.get(`/proofs/${f.proofs.cli}/file`);
  expect(file.status()).toBe(404);
  // Own proof whose storage object is missing: a clean 404, not a 500 with a stack trace (regression).
  expect((await page.request.get(`/proofs/${f.iso.proof}/file`)).status()).toBe(404);
  const csv = await (await page.request.get("/exports/invoices")).text();
  expect(csv).not.toContain("DA-0");
});

test("every action refuses Demo Agency ids and changes nothing there", async ({ page }) => {
  const f = await fixtureIds();
  const before = await demoState();
  const demoApproval = (await db().query("select id from public.approvals where tenant_id = $1 and status = 'pending' limit 1", [DEMO_TENANT])).rows[0]?.id ?? f.approvals["DA-0002"];
  const demoTask = (await db().query("select id from public.tasks where tenant_id = $1 and status = 'open' limit 1", [DEMO_TENANT])).rows[0]?.id ?? f.tasks["e2e-claim"];
  const demoInvoice = (await db().query("select id from public.invoices where tenant_id = $1 and number = 'DA-0015'", [DEMO_TENANT])).rows[0].id;
  const demoProof = (await db().query("select id from public.payment_proofs where tenant_id = $1 limit 1", [DEMO_TENANT])).rows[0].id;
  const demoMessage = (await db().query("insert into public.messages (tenant_id, customer_id, channel, direction, idempotency_key, send_state, step_id, pending_since, purpose, attempt) select $1, customer_id, 'email', 'out', id || ':s9:email', 'unknown', 's9', now(), 'reminder', 1 from public.invoices where id = $2 returning id", [DEMO_TENANT, demoInvoice])).rows[0].id;
  await db().query("insert into public.message_invoices (tenant_id, message_id, invoice_id) values ($1, $2, $3)", [DEMO_TENANT, demoMessage, demoInvoice]);
  const demoPromise = (await db().query("insert into public.promises (tenant_id, invoice_id, customer_id, promised_on, status, reference_at) select $1, id, customer_id, current_date + 3, 'active', now() from public.invoices where id = $2 returning id", [DEMO_TENANT, demoInvoice])).rows[0].id;
  const mid = await demoState();

  // Approve
  await page.goto("/approvals");
  await swap(page, "approval", demoApproval);
  await page.locator(`[data-approval]`).first().getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /not allowed|Not found/ })).toBeVisible();
  // Resolve task
  await page.goto(`/tasks/${f.iso.task}`);
  await swap(page, "task", demoTask);
  await page.getByLabel("How was it resolved?").fill("idor attempt");
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /not allowed|Not found/ })).toBeVisible();
  // Reconcile unknown message
  await page.goto("/messages");
  await swap(page, "message", demoMessage);
  const card = page.locator("[data-message]").first();
  await card.getByLabel(/I checked with the provider/).check();
  await card.getByRole("button", { name: "It was sent" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Message not found." })).toBeVisible();
  // Cancel promise
  await page.goto(`/invoices/${f.iso.invoice}`);
  await swap(page, "promise", demoPromise);
  await page.getByLabel("Reason").fill("idor attempt");
  await page.getByRole("button", { name: "Cancel promise" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /not allowed|Not found/ })).toBeVisible();
  // Record payment
  await page.goto(`/payments/new?invoice=${f.iso.invoice}`);
  await swap(page, "invoice", demoInvoice);
  await page.getByLabel("Amount received").fill("1.00");
  await page.getByLabel("Date the money arrived").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Bank reference").fill("IDOR-1");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invoice not found." })).toBeVisible();
  // Proof decisions
  await page.goto(`/proofs/${f.iso.proof}`);
  await swap(page, "proof", demoProof);
  await page.getByLabel("Or reject it (reason required)").fill("idor attempt");
  await page.getByRole("button", { name: "Reject proof" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Proof not found." })).toBeVisible();

  expect(await demoState()).toEqual(mid);
  expect(before.rc).toEqual(mid.rc);
  // And the outsider's own objects were not touched either (the forged id was the one submitted).
  const own = await db().query("select status from public.approvals where id = $1", [f.iso.approval]);
  expect(own.rows[0].status).toBe("pending");
});
