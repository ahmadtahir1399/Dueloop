// Step 4: every action screen calls the existing RPC/pipeline; the role matrix holds in the UI.
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { db } from "../support/db";
import { authFile, fixtureIds } from "../support/users";

const today = () => new Date().toISOString().slice(0, 10);

test.describe("as accountant", () => {
  test.use({ storageState: authFile("accountant") });

  test("bulk approve needs the exact count (runs first, while approvals are pending)", async ({ page }) => {
    await page.goto("/approvals");
    const form = page.getByRole("form", { name: "Approve several" });
    await form.getByRole("checkbox").first().check();
    await form.getByLabel("Type how many you selected, to confirm").fill("2");
    await form.getByRole("button", { name: "Approve selected" }).click();
    await expect(form.getByRole("alert")).toContainText("Nothing was approved");
  });

  test("approves and rejects with a reason; the preview uses the real renderer with the footer", async ({ page }) => {
    const f = await fixtureIds();
    await page.goto("/approvals");
    const a1 = page.locator(`[data-approval="${f.approvals["DA-0001"]}"]`);
    await expect(a1).toContainText("--"); // footer separator appended by the renderer
    await a1.getByRole("button", { name: "Approve" }).click();
    await expect(a1).toHaveCount(0); // decided approvals leave the pending list
    const a2 = page.locator(`[data-approval="${f.approvals["DA-0002"]}"]`);
    await a2.getByRole("button", { name: "Reject" }).click();
    await expect(a2.getByRole("alert")).toContainText("Say why");
    await a2.getByLabel("Reason (needed to reject)").fill("customer asked for a pause");
    await a2.getByRole("button", { name: "Reject" }).click();
    await expect(a2).toHaveCount(0);
    const r = await db().query("select id, status from public.approvals where id = any($1)", [[f.approvals["DA-0001"], f.approvals["DA-0002"]]]);
    expect(Object.fromEntries(r.rows.map((x) => [x.id, x.status]))).toEqual({ [f.approvals["DA-0001"]]: "approved", [f.approvals["DA-0002"]]: "rejected" });
  });

  test("records a manual payment: preview first, then confirm", async ({ page }) => {
    const id = (await db().query("select id from public.invoices where number = 'DA-0012'")).rows[0].id;
    await page.goto(`/payments/new?invoice=${id}`);
    await page.getByLabel("Amount received").fill("1.00");
    await page.getByLabel("Date the money arrived").fill(today());
    await page.getByLabel("Bank reference").fill("E2E-UI-PAY-1");
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByTestId("payment-plan")).toContainText("Applied to the invoice: £1.00");
    await page.getByRole("button", { name: "Confirm and record" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Recorded" })).toBeVisible();
    const r = await db().query("select amount, source from public.receipts where provider_ref = 'E2E-UI-PAY-1'");
    expect(r.rows).toEqual([{ amount: "100", source: "manual" }]);
  });

  test("views a proof file through the sandboxed route and confirms it", async ({ page, baseURL }) => {
    const f = await fixtureIds();
    await page.goto(`/proofs/${f.proofs.ui}`);
    await expect(page.getByText("UNTRUSTED hints")).toBeVisible();
    const res = await page.request.get(`/proofs/${f.proofs.ui}/file`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["content-security-policy"]).toContain("sandbox");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["content-disposition"]).not.toContain("svg");
    const anonCtx = await playwrightRequest.newContext({ baseURL: baseURL ?? "", storageState: { cookies: [], origins: [] } }); // explicitly no cookies (the test storageState is inherited otherwise)
    const anon = await anonCtx.get(`/proofs/${f.proofs.ui}/file`, { maxRedirects: 0 });
    // Signed out: never the file (a redirect to /login, which the client may follow, or a 404).
    expect(anon.headers()["content-type"] ?? "").not.toContain("image/");
    expect(anon.url().endsWith("/login") || [302, 307, 404].includes(anon.status())).toBe(true);
    await anonCtx.dispose();
    await page.getByLabel("Amount received").fill("2.00");
    await page.getByLabel("Date the money arrived").fill(today());
    await page.getByLabel("Bank reference").fill("E2E-UI-PROOF-1");
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByTestId("payment-plan")).toBeVisible();
    await page.getByRole("button", { name: "Confirm and record" }).click();
    await expect(page.getByText("Status: confirmed")).toBeVisible(); // the page re-renders without the form
    const r = await db().query("select status from public.payment_proofs where id = $1", [f.proofs.ui]);
    expect(r.rows[0].status).toBe("confirmed");
  });

  test("cancels a promise with a reason", async ({ page }) => {
    const id = (await db().query("select id from public.invoices where number = 'DA-0011'")).rows[0].id;
    await page.goto(`/invoices/${id}`);
    await page.getByLabel("Reason").fill("agreed by phone");
    await page.getByRole("button", { name: "Cancel promise" }).click();
    await expect(page.getByTestId("active-promise")).toHaveCount(0);
    const r = await db().query("select status, resolution_note from public.promises where invoice_id = $1 order by created_at desc limit 1", [id]);
    expect(r.rows[0]).toEqual({ status: "cancelled", resolution_note: "agreed by phone" });
  });
});

test.describe("as owner", () => {
  test.use({ storageState: authFile("owner") });
  test("reconciles an unknown message as sent", async ({ page }) => {
    const f = await fixtureIds();
    await page.goto("/messages");
    const m = page.locator(`[data-message="${f.unknown.ui}"]`);
    await m.getByLabel(/I checked with the provider/).check();
    await m.getByRole("button", { name: "It was sent" }).click();
    await expect(m).toHaveCount(0); // reconciled messages leave the list
    const r = await db().query("select send_state from public.messages where id = $1", [f.unknown.ui]);
    expect(r.rows[0].send_state).toBe("sent");
  });
});

test.describe("as collector", () => {
  test.use({ storageState: authFile("collector") });

  test("sees approvals but has no decision buttons; cannot open payment recording or unknown sends", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    const inv = (await db().query("select id from public.invoices where number = 'DA-0012'")).rows[0].id;
    await page.goto(`/payments/new?invoice=${inv}`);
    await expect(page.getByText("Not found")).toBeVisible();
    await page.goto("/messages");
    await expect(page.getByText("Not found")).toBeVisible();
  });

  test("resolves a task with a note; the AI draft is copy-only", async ({ page }) => {
    const f = await fixtureIds();
    await page.goto(`/tasks/${f.tasks["e2e-claim"]}`);
    await expect(page.getByTestId("blocks-until")).toContainText("paused until");
    await expect(page.getByRole("textbox", { name: "Suggested reply" })).toHaveAttribute("readonly", "");
    await page.getByLabel("How was it resolved?").fill("checked the bank statement: not paid yet");
    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Resolved" })).toBeVisible();
  });
});
