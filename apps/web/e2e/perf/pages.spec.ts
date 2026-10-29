// Issue R: page server times against the large tenant from `pnpm perf:seed` (run it first). The e2e owner is added
// to "Perf Co" and switches to it; each page is fetched 5 times; the median server time (time to the full HTML
// response, measured by the client on localhost) is printed. Numbers from this machine only.
import { expect, test } from "@playwright/test";
import { db } from "../support/db";
import { authFile, USERS } from "../support/users";

const PERF = "9e7f0000-0000-4000-8000-00000000000a";
test.use({ storageState: authFile("owner") });

test("page server times on the 50k tenant", async ({ page, context }) => {
  const n = (await db().query("select count(*)::int as n from public.invoices where tenant_id = $1", [PERF])).rows[0]?.n ?? 0;
  expect(n, "run pnpm perf:seed first").toBeGreaterThan(1000);
  await db().query(
    "insert into public.memberships (tenant_id, user_id, role) select $1, id, 'owner' from auth.users where email = $2 on conflict do nothing",
    [PERF, USERS.owner.email],
  );
  await context.addCookies([{ name: "dl_tenant", value: PERF, domain: "localhost", path: "/" }]);
  const out: { page: string; median_ms: number }[] = [];
  for (const p of ["/invoices", "/invoices?status=overdue", "/invoices?bucket=31-60", "/invoices?q=PF-00123", "/customers", "/"]) {
    const t: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const r = await page.request.get(p);
      t.push(performance.now() - t0);
      expect(r.status()).toBe(200);
    }
    t.sort((a, b) => a - b);
    out.push({ page: p, median_ms: Math.round(t[2] ?? 0) });
  }
  console.log(`PERF PAGES ${JSON.stringify({ invoices: n, pages: out })}`);
  await db().query("delete from public.memberships where tenant_id = $1 and user_id = (select id from auth.users where email = $2)", [PERF, USERS.owner.email]);
});
