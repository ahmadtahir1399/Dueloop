// Steps 5-7: import wizard (prompt 2 fixtures), exports with formula neutralisation and logging, kill switch,
// polled counters.
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { db } from "../support/db";
import { authFile, DEMO_TENANT } from "../support/users";

const FIX = path.resolve(__dirname, "../../../../packages/ingest/fixtures");

async function mapAndPreview(page: Page, file: { name: string; mimeType: string; buffer: Buffer } | string, format: "DMY" | "MDY" | "YMD") {
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText("2. Match the columns and options")).toBeVisible();
  await page.getByRole("combobox", { name: "Date format *" }).click();
  await page.getByRole("option", { name: new RegExp(`^${format}`) }).click();
  await page.getByLabel("Phone country *").fill("GB");
  await page.getByRole("button", { name: "Preview import (dry run)" }).click();
}

test.describe("as owner", () => {
  test.use({ storageState: authFile("owner") });

  test("imports the clean fixture: dry run shows normalised rows, then commits", async ({ page }) => {
    await mapAndPreview(page, path.join(FIX, "clean.csv"), "YMD");
    const sample = page.getByTestId("import-sample");
    await expect(sample).toContainText("INV-1001");
    await expect(sample).toContainText("£1,250.00");
    await expect(page.getByTestId("ambiguous-dates")).toHaveCount(0);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Import complete")).toBeVisible();
    const r = await db().query("select count(*)::int as n from public.invoices where tenant_id = $1 and number like 'INV-10%'", [DEMO_TENANT]);
    expect(r.rows[0].n).toBeGreaterThan(0);
  });

  test("warns when no date proves DMY vs MDY", async ({ page }) => {
    const csv = "invoice_no,customer,email,amount,currency,issued,due\nAMB-1,Amb Co,a@amb.example,10.00,GBP,03/04/2026,05/06/2026\n";
    await mapAndPreview(page, { name: "ambiguous.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }, "DMY");
    await expect(page.getByTestId("ambiguous-dates")).toContainText("No date in this file proves the format");
  });

  test("refuses a file over the size cap before parsing it", async ({ page }) => {
    await page.goto("/import");
    const big = Buffer.alloc(5 * 1024 * 1024 + 100_000, "a");
    await page.locator('input[type="file"]').setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: big });
    await expect(page.getByText(/larger than 5 MB/)).toBeVisible();
  });

  test("hostile fixture: imported with skip-invalid, then every exported cell is formula-neutralised and the export is logged", async ({ page }) => {
    await mapAndPreview(page, path.join(FIX, "hostile.csv"), "YMD");
    const skip = page.getByLabel(/Skip the \d+ rows with errors/);
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled(); // invalid rows: not without the explicit checkbox
    await skip.check();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Import complete")).toBeVisible();

    await page.goto("/invoices");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await (await download).path();
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(file, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const cells = text.slice(1).split(/\r\n/).filter(Boolean).flatMap((l) => l.match(/"(?:[^"]|"")*"/g) ?? []);
    expect(cells.length).toBeGreaterThan(10);
    for (const c of cells) expect(c, `cell ${c}`).not.toMatch(/^"[=+\-@\t\r]/);
    expect(text).toContain(`"'=HYPERLINK(`);
    const logged = await db().query("select payload from public.tenant_events where tenant_id = $1 and type = 'AuditExported' and payload->>'list' = 'invoices'", [DEMO_TENANT]);
    expect(logged.rows.length).toBeGreaterThan(0);
  });

  test("kill switch: typed confirmation, banner for everyone, resume", async ({ page, browser }) => {
    await page.goto("/settings");
    const ks = page.getByRole("form", { name: "Kill switch" });
    await ks.getByLabel("Type PAUSE to confirm").fill("STOP");
    await ks.getByRole("button", { name: "Pause all sending" }).click();
    await expect(ks.getByRole("alert")).toContainText("Type PAUSE");
    await ks.getByLabel("Type PAUSE to confirm").fill("pause");
    await ks.getByRole("button", { name: "Pause all sending" }).click();
    await expect(page.getByTestId("paused-banner")).toBeVisible();
    expect((await db().query("select outbound_paused from public.tenants where id = $1", [DEMO_TENANT])).rows[0].outbound_paused).toBe(true);
    const collector = await browser.newContext({ storageState: authFile("collector") });
    const cp = await collector.newPage();
    await cp.goto("/invoices");
    await expect(cp.getByTestId("paused-banner")).toBeVisible();
    await cp.goto("/settings");
    await expect(cp.getByRole("form", { name: "Kill switch" })).toHaveCount(0);
    await collector.close();
    await page.goto("/settings");
    await page.getByLabel("Type RESUME to confirm").fill("RESUME");
    await page.getByRole("button", { name: "Resume sending" }).click();
    await expect(page.getByTestId("paused-banner")).toHaveCount(0);
  });

  test("counters endpoint returns numbers for the active tenant only", async ({ page }) => {
    await page.goto("/");
    const r = await page.request.get("/counters");
    expect(r.status()).toBe(200);
    const body = (await r.json()) as Record<string, number>;
    for (const k of ["approvals", "tasks", "unknownMessages", "proofs"]) expect(typeof body[k]).toBe("number");
    const t = await db().query("select count(*)::int as n from public.tasks where tenant_id = $1 and status = 'open'", [DEMO_TENANT]);
    expect(body.tasks).toBe(t.rows[0].n);
  });
});

test.describe("audit export", () => {
  test.use({ storageState: authFile("accountant") });
  test("accountant downloads the audit CSV for a local-day range; it is logged with the row count", async ({ page }) => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await page.request.get(`/exports/audit?from=2026-01-01&to=${today}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("time (Europe/London)");
    expect(body).not.toContain("@demo-agency"); // no contact details
    const r = await db().query("select payload from public.tenant_events where tenant_id = $1 and type = 'AuditExported' and payload ? 'from' order by id desc limit 1", [DEMO_TENANT]);
    expect(Number(r.rows[0].payload.rows)).toBeGreaterThan(0);
  });
});

test.describe("collector", () => {
  test.use({ storageState: authFile("collector") });
  test("cannot download the audit export or open the import wizard", async ({ page }) => {
    const res = await page.request.get("/exports/audit?from=2026-01-01&to=2026-12-31");
    expect(res.status()).toBe(404);
    await page.goto("/import");
    await expect(page.getByText("Not found")).toBeVisible();
  });
});
