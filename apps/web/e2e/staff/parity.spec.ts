// Step 4 parity: each UI action yields the same database outcome as its CLI twin for the same input. Twin fixtures
// (one for the UI, one for the CLI) are compared after normalising ids, actors and timestamps.
import { expect, test } from "@playwright/test";
import { cli } from "../support/cli";
import { db } from "../support/db";
import { authFile, fixtureIds } from "../support/users";

test.use({ storageState: authFile("owner") });
const today = () => new Date().toISOString().slice(0, 10);

async function events(invoiceId: string) {
  const r = await db().query<{ type: string }>("select type from public.invoice_events where invoice_id = $1 and type not in ('InvoiceImported','InvoiceOverdue') order by id", [invoiceId]);
  return r.rows.map((x) => x.type);
}

test("approve: UI == pnpm approvals approve", async ({ page }) => {
  const f = await fixtureIds();
  await page.goto("/approvals");
  await page.locator(`[data-approval="${f.approvals["DA-0003"]}"]`).getByRole("button", { name: "Approve" }).click();
  await expect(page.locator(`[data-approval="${f.approvals["DA-0003"]}"]`)).toHaveCount(0);
  const c = cli(["approvals", "approve", f.approvals["DA-0004"]]);
  expect(c.code, c.out).toBe(0);
  const r = await db().query("select id, invoice_id, status, decided_at is not null as decided, version from public.approvals where id = any($1) order by id", [[f.approvals["DA-0003"], f.approvals["DA-0004"]]]);
  const [a, b] = r.rows;
  expect({ status: a.status, decided: a.decided, version: a.version }).toEqual({ status: b.status, decided: b.decided, version: b.version });
  expect(await events(a.invoice_id)).toEqual(await events(b.invoice_id));
});

test("resolve task: UI == pnpm tasks resolve", async ({ page }) => {
  const f = await fixtureIds();
  const note = "parity: checked with the customer";
  await page.goto(`/tasks/${f.tasks["e2e-parity-ui"]}`);
  await page.getByLabel("How was it resolved?").fill(note);
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Resolved" })).toBeVisible();
  const c = cli(["tasks", "resolve", f.tasks["e2e-parity-cli"], "--note", note]);
  expect(c.code, c.out).toBe(0);
  const r = await db().query("select status, resolution_note, resolved_at is not null as at, blocks_reminders_until from public.tasks where id = any($1)", [[f.tasks["e2e-parity-ui"], f.tasks["e2e-parity-cli"]]]);
  expect(r.rows[0]).toEqual(r.rows[1]);
});

test("reconcile unknown as sent: UI == pnpm messages resolve", async ({ page }) => {
  const f = await fixtureIds();
  // The UI twin of this pair is reconciled as SENT in actions.spec; here the CLI twin goes through the same
  // state change and both must end identical in send_state and events.
  const c = cli(["messages", "resolve", f.unknown.cli, "--as", "sent"]);
  expect(c.code, c.out).toBe(0);
  await page.goto("/messages");
  const ui = page.locator(`[data-message="${f.unknown.ui}"]`);
  if (await ui.count()) {
    await ui.getByLabel(/I checked with the provider/).check();
    await ui.getByRole("button", { name: "It was sent" }).click();
    await expect(ui).toHaveCount(0);
  }
  const r = await db().query<{ id: string; send_state: string; invoice_id: string }>(
    "select m.id, m.send_state, mi.invoice_id from public.messages m join public.message_invoices mi on mi.message_id = m.id where m.id = any($1)",
    [[f.unknown.ui, f.unknown.cli]],
  );
  expect(r.rows.map((x) => x.send_state)).toEqual(["sent", "sent"]);
  const [x, y] = r.rows;
  expect(x && y).toBeTruthy();
  expect(await events(x?.invoice_id ?? "")).toEqual(await events(y?.invoice_id ?? ""));
});

test("record payment: UI == pnpm payments record --yes", async ({ page }) => {
  const ids = (await db().query("select number, id from public.invoices where number in ('DA-0013','DA-0014')")).rows;
  const id = (n: string) => ids.find((r) => r.number === n).id as string;
  await page.goto(`/payments/new?invoice=${id("DA-0013")}`);
  await page.getByLabel("Amount received").fill("3.00");
  await page.getByLabel("Date the money arrived").fill(today());
  await page.getByLabel("Bank reference").fill("PARITY-UI");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Confirm and record" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recorded" })).toBeVisible();
  const ownerEmail = "owner@e2e.test";
  const c = cli(["payments", "record", "--tenant", "Demo Agency", "--invoice", "DA-0014", "--amount", "3.00", "--date", today(), "--bank-ref", "PARITY-CLI", "--user", ownerEmail, "--yes"]);
  expect(c.code, c.out).toBe(0);
  const r = await db().query(
    `select r.amount, r.source, r.method, (select count(*) from public.payments p where p.receipt_id = r.id) as slices,
            (select coalesce(sum(amount),0) from public.credits k where k.receipt_id = r.id) as credit
     from public.receipts r where r.provider_ref in ('PARITY-UI', 'PARITY-CLI') order by r.provider_ref`,
  );
  expect(r.rows).toHaveLength(2);
  expect(r.rows[0]).toEqual(r.rows[1]);
  expect(await events(id("DA-0013"))).toEqual(await events(id("DA-0014")));
});

test("confirm proof: UI == pnpm proofs confirm --yes", async ({ page }) => {
  const f = await fixtureIds();
  // The UI twin is confirmed in actions.spec (amount 2.00); confirm the CLI twin with the same amount and compare.
  const c = cli(["proofs", "confirm", f.proofs.cli, "--amount", "2.00", "--date", today(), "--bank-ref", "E2E-CLI-PROOF-1", "--user", "owner@e2e.test", "--yes"]);
  expect(c.code, c.out).toBe(0);
  await page.goto("/proofs?status=confirmed");
  const r = await db().query(
    `select p.status, r.amount, r.source from public.payment_proofs p join public.receipts r on r.id = p.receipt_id where p.id = any($1) order by p.id`,
    [[f.proofs.ui, f.proofs.cli]],
  );
  expect(r.rows).toHaveLength(2);
  expect(r.rows[0]).toEqual(r.rows[1]);
});
