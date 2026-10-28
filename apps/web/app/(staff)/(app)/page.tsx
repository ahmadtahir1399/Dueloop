import Link from "next/link";
import { AgeingChart } from "@/components/ageing-chart";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@dueloop/authz";
import { loadOverview } from "@/lib/data/overview";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { formatDate, isPeriodKey, PERIODS, periodRange } from "@/lib/time";

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const ctx = await requirePermission("overview.view");
  const sp = await searchParams;
  const period = isPeriodKey(sp.period) ? sp.period : "this_month";
  const { from, to } = periodRange(period, ctx.tenant.timezone, new Date());
  const o = await loadOverview(ctx, from, to);

  if (o.invoiceCount === 0) {
    return (
      <EmptyState title="No invoices yet">
        <p>Import a CSV export from your accounting tool or spreadsheet to get started.</p>
        {can(ctx.role, "import.run") ? (
          <Button asChild className="mt-4">
            <Link href="/import">Import invoices</Link>
          </Button>
        ) : null}
      </EmptyState>
    );
  }

  const money = (rows: { currency: string; v: string }[]) =>
    rows.length === 0 ? "—" : rows.map((r) => formatMinor(r.v, r.currency)).join(" · ");
  const sent = o.messages.reduce((s, m) => s + m.sent, 0);
  const cost = o.messages.reduce((s, m) => s + BigInt(m.cost), 0n);
  const rate = o.promise?.rate ? `${(Number(o.promise.rate) * 100).toFixed(0)}%` : "—";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Overview</h1>
        <form method="get" className="flex items-center gap-2 text-sm">
          <label htmlFor="period">Period</label>
          <select id="period" name="period" defaultValue={period} className="h-8 rounded-md border bg-background px-2">
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline">
            Show
          </Button>
        </form>
      </div>
      <p className="text-sm text-muted-foreground" data-testid="period-range">
        {formatDate(from)} – {formatDate(to)}, in {ctx.tenant.timezone} (the business&apos;s local days)
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label="Overdue now" testId="kpi-overdue">
          {money(o.overdue.map((r) => ({ currency: r.currency, v: r.balance })))}
          <span className="block text-sm font-normal text-muted-foreground">
            {o.overdue.reduce((s, r) => s + r.invoices, 0)} invoices
          </span>
        </Kpi>
        <Kpi label="Recovered in period" testId="kpi-recovered">
          {money(o.recovered.map((r) => ({ currency: r.currency, v: r.recovered })))}
        </Kpi>
        <Kpi label="Promise-kept rate" testId="kpi-promise">
          {rate}
          <span className="block text-sm font-normal text-muted-foreground">
            {o.promise ? `${o.promise.kept} kept, ${o.promise.broken} broken` : "No promises resolved in this period"}
          </span>
        </Kpi>
        <Kpi label="Average days to pay" testId="kpi-days">
          {o.daysToPay?.avgDaysToPay ?? "—"}
          <span className="block text-sm font-normal text-muted-foreground">
            {o.daysToPay ? `${o.daysToPay.invoices} invoices paid; ${o.daysToPay.avgDaysAfterDue} days after due on average` : "No invoices paid in this period"}
          </span>
        </Kpi>
        <Kpi label="Messages sent and cost" testId="kpi-messages">
          {sent}
          <span className="block text-sm font-normal text-muted-foreground">
            cost {formatMinor(cost.toString(), ctx.tenant.currency)}
          </span>
        </Kpi>
      </div>

      <section aria-labelledby="ageing-h" className="grid gap-3">
        <h2 id="ageing-h" className="text-lg font-semibold">
          Ageing of open invoices
        </h2>
        <AgeingChart rows={o.ageing} />
      </section>
    </div>
  );
}

function Kpi({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{children}</CardTitle>
      </CardHeader>
    </Card>
  );
}
