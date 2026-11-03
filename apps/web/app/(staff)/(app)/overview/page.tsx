import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronRight } from "lucide-react";
import { can } from "@dueloop/authz";
import { AgeingChart } from "@/components/ageing-chart";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { KpiTile } from "@/components/ui/kpi-tile";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Chip, type Tone } from "@/components/ui/status-chip";
import { loadOverview } from "@/lib/data/overview";
import { formatMinor } from "@/lib/money";
import { navFor, waitingTotal, type CounterKey } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { loadCounters } from "@/lib/shell";
import { formatDate, isPeriodKey, PERIODS, periodRange } from "@/lib/time";

const QUEUES: { key: CounterKey; href: string; chip: string; tone: Tone; what: (n: number) => string; action: string }[] = [
  { key: "approvals", href: "/approvals", chip: "Approval", tone: "info", what: (n) => `${n} reminder${n === 1 ? "" : "s"} waiting for approval`, action: "Review" },
  { key: "unknownMessages", href: "/messages", chip: "Unknown send", tone: "warning", what: (n) => `${n} send${n === 1 ? "" : "s"} with an unclear result`, action: "Check" },
  { key: "tasks", href: "/tasks", chip: "Task", tone: "neutral", what: (n) => `${n} open task${n === 1 ? "" : "s"}: replies, claims and disputes`, action: "Open" },
  { key: "proofs", href: "/proofs", chip: "Proof", tone: "success", what: (n) => `${n} payment proof${n === 1 ? "" : "s"} to check`, action: "Decide" },
];

function greeting(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** S05 Overview: one question answered at a glance, "what needs me?" (§4.4). Existing KPI data only (C-11). */
export default async function OverviewPage({ searchParams }: PageProps<"/overview">) {
  const ctx = await requirePermission("overview.view");
  const sp = await searchParams;
  const period = isPeriodKey(sp.period) ? sp.period : "this_month";
  const now = new Date();
  const { from, to } = periodRange(period, ctx.tenant.timezone, now);
  const [o, counters] = await Promise.all([loadOverview(ctx, from, to), loadCounters(ctx)]);
  const local = DateTime.fromJSDate(now, { zone: ctx.tenant.timezone });
  const canImport = can(ctx.role, "import.run");

  if (o.invoiceCount === 0) {
    return (
      <div className="grid gap-8">
        <PageHeader title="Overview" description="Totals and the work waiting for you appear here once invoices are in." />
        <EmptyState
          title="No invoices yet"
          action={
            canImport ? (
              <Button asChild>
                <Link href="/import">Import invoices</Link>
              </Button>
            ) : undefined
          }
        >
          Import a CSV or connect the API to get started.
        </EmptyState>
      </div>
    );
  }

  const visibleQueues = new Set(navFor(ctx.role).map((n) => n.counter).filter(Boolean));
  const queues = QUEUES.filter((q) => visibleQueues.has(q.key));
  const total = waitingTotal(Object.fromEntries(queues.map((q) => [q.key, counters[q.key] ?? 0])));
  const waiting = queues.filter((q) => (counters[q.key] ?? 0) > 0);
  const money = (rows: { currency: string; v: string }[]) => (rows.length === 0 ? "—" : rows.map((r) => formatMinor(r.v, r.currency)).join(" · "));
  const sent = o.messages.reduce((s, m) => s + m.sent, 0);
  const cost = o.messages.reduce((s, m) => s + BigInt(m.cost), 0n);
  const rate = o.promise?.rate ? `${(Number(o.promise.rate) * 100).toFixed(0)}%` : "—";
  const periodLabel = PERIODS.find((p) => p.key === period)?.label.toLowerCase() ?? "";
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={`${local.toFormat("cccc, d LLLL")} · times in ${ctx.tenant.timezone}`}
        title={total > 0 ? `${greeting(local.hour)}. ${total} thing${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} you.` : `${greeting(local.hour)}. Nothing needs you right now.`}
        actions={
          <>
            {canImport ? (
              <Button asChild variant="outline">
                <Link href="/import">Import invoices</Link>
              </Button>
            ) : null}
            {(counters.approvals ?? 0) > 0 && visibleQueues.has("approvals") ? (
              <Button asChild>
                <Link href="/approvals">Review approvals</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <section aria-labelledby="kpi-h" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="kpi-h" className="sr-only">
            Key figures
          </h2>
          <p className="t-caption text-ink-muted" data-testid="period-range">
            {formatDate(from)} – {formatDate(to)}, in {ctx.tenant.timezone} (the business&apos;s local days)
          </p>
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="period" className="t-body-sm text-ink-muted">
              Period
            </label>
            <ChoiceSelect id="period" name="period" defaultValue={period} size="sm" className="w-40" options={PERIODS.map((p) => ({ value: p.key, label: p.label }))} />
            <Button type="submit" size="sm" variant="outline">
              Show
            </Button>
          </form>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 wide:grid-cols-4">
          <KpiTile
            testId="kpi-overdue"
            label="Overdue now"
            href="/invoices?status=overdue"
            value={money(o.overdue.map((r) => ({ currency: r.currency, v: r.balance })))}
            sub={`${o.overdue.reduce((s, r) => s + r.invoices, 0)} invoices`}
          />
          <KpiTile
            testId="kpi-recovered"
            label={`Collected, ${periodLabel}`}
            href="/invoices?status=paid"
            value={money(o.recovered.map((r) => ({ currency: r.currency, v: r.recovered })))}
            sub="confirmed payments only"
          />
          <KpiTile
            testId="kpi-promise"
            label="Promises kept"
            href="/invoices?status=promised"
            value={rate}
            sub={o.promise ? `${o.promise.kept} kept, ${o.promise.broken} broken` : "No promises resolved in this period"}
          />
          <KpiTile
            testId="kpi-days"
            label="Average days to pay"
            value={o.daysToPay?.avgDaysToPay ?? "—"}
            sub={o.daysToPay ? `${o.daysToPay.invoices} invoices paid; ${o.daysToPay.avgDaysAfterDue} days after due on average` : "No invoices paid in this period"}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="attention-h" className="card-edge grid content-start gap-2 rounded-xl border border-line bg-panel p-5">
          <SectionTitle id="attention-h">Needs attention</SectionTitle>
          {waiting.length === 0 ? (
            <p className="py-6 t-body-md text-ink-muted">Nothing is waiting for a decision. New approvals, tasks and proofs appear here.</p>
          ) : (
            <ul className="divide-y divide-line">
              {waiting.map((q) => (
                <li key={q.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <Chip tone={q.tone}>{q.chip}</Chip>
                  <span className="min-w-0 flex-1 t-body-md text-ink">{q.what(counters[q.key] ?? 0)}</span>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={q.href}>
                      {q.action}
                      <span className="sr-only"> {q.chip.toLowerCase()}s</span>
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ageing-h" className="on-inverse card-edge grid content-start gap-4 rounded-xl bg-inverse p-5 text-ink-inverse">
          <h2 id="ageing-h" className="t-heading-md">
            Open balance by age
          </h2>
          <AgeingChart rows={o.ageing} inverse />
          <div className="grid gap-1 border-t border-inverse-raised pt-3 t-caption text-ink-inverse-muted" data-testid="kpi-messages">
            <p>
              Sending: {ctx.tenant.outboundPaused ? "Paused" : "On"}
              {ctx.tenant.quietStartHour !== ctx.tenant.quietEndHour ? ` · quiet hours ${hh(ctx.tenant.quietStartHour)}–${hh(ctx.tenant.quietEndHour)}` : ""}
            </p>
            <p>
              Messages sent, {periodLabel}: <span className="tabular-nums text-ink-inverse">{sent}</span> · cost {formatMinor(cost.toString(), ctx.tenant.currency)}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
