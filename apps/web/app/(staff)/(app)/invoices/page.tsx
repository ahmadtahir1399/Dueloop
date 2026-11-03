import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { can } from "@dueloop/authz";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip, STATUS_VISUAL } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LIST_BUCKETS, listInvoicePage, parseFilters, STATUSES } from "@/lib/data/invoices";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { formatDate } from "@/lib/time";
import { cn } from "cn";

const BUCKET_TEXT: Record<string, string> = {
  not_due: "Not yet due",
  "1-30": "1-30 days",
  "31-60": "31-60 days",
  "61-90": "61-90 days",
  "91+": "Over 90 days",
  closed: "Closed",
};

/** Common cuts as tabs (links that set ?status=); the dropdowns cover the rest (§4.4 S06). No counts: C-14. */
const TABS: { label: string; status?: (typeof STATUSES)[number] }[] = [
  { label: "All" },
  { label: "Overdue", status: "overdue" },
  { label: "Promised", status: "promised" },
  { label: "Disputed", status: "disputed" },
  { label: "Needs a person", status: "escalated" },
  { label: "Paid", status: "paid" },
];

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  const ctx = await requirePermission("invoices.view");
  const sp = await searchParams;
  const f = parseFilters(sp);
  const { rows, next } = await listInvoicePage(ctx, f);
  const keep = new URLSearchParams();
  if (f.status) keep.set("status", f.status);
  if (f.bucket) keep.set("bucket", f.bucket);
  if (f.customer) keep.set("customer", f.customer);
  if (f.q) keep.set("q", f.q);
  const filtered = keep.size > 0;
  const tabHref = (status?: string) => {
    const p = new URLSearchParams(keep);
    if (status) p.set("status", status);
    else p.delete("status");
    const s = p.toString();
    return s ? `/invoices?${s}` : "/invoices";
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Invoices"
        description="Every invoice, its status and what is still owed."
        actions={
          <>
            {can(ctx.role, "export.lists") ? (
              <Button asChild variant="outline">
                <a href={`/exports/invoices?${keep.toString()}`} download>
                  Export CSV
                </a>
              </Button>
            ) : null}
            {can(ctx.role, "import.run") ? (
              <Button asChild>
                <Link href="/import">Import</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4">
        <form method="get" className="flex flex-wrap items-end gap-3" role="search" aria-label="Filter invoices">
          <div className="grid gap-1.5">
            <label htmlFor="q" className="t-body-sm font-semibold text-ink">
              Search
            </label>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
              <Input id="q" name="q" defaultValue={f.q ?? ""} placeholder="Number or customer" className="w-64 pl-9" maxLength={60} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="status" className="t-body-sm font-semibold text-ink">
              Status
            </label>
            <ChoiceSelect
              id="status"
              name="status"
              defaultValue={f.status ?? ""}
              className="w-44"
              options={[{ value: "", label: "Any" }, ...STATUSES.map((s) => ({ value: s, label: STATUS_VISUAL[s].label }))]}
            />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="bucket" className="t-body-sm font-semibold text-ink">
              Age
            </label>
            <ChoiceSelect
              id="bucket"
              name="bucket"
              defaultValue={f.bucket ?? ""}
              className="w-40"
              options={[{ value: "", label: "Any" }, ...LIST_BUCKETS.map((b) => ({ value: b, label: BUCKET_TEXT[b] ?? b }))]}
            />
          </div>
          {f.customer ? <input type="hidden" name="customer" value={f.customer} /> : null}
          <Button type="submit" variant="outline">
            Filter
          </Button>
          {filtered ? (
            <Button asChild variant="ghost">
              <Link href="/invoices">Clear filters</Link>
            </Button>
          ) : null}
        </form>

        <nav aria-label="Invoice status" className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((t) => {
            const active = (f.status ?? undefined) === t.status;
            return (
              <Link
                key={t.label}
                href={tabHref(t.status)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center border-b-2 px-3 t-body-sm font-medium whitespace-nowrap transition-colors-fast",
                  active ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title="Nothing matches"
            action={
              <Button asChild variant="outline">
                <Link href="/invoices">Clear filters</Link>
              </Button>
            }
          >
            Try another status or clear the filters.
          </EmptyState>
        ) : (
          <EmptyState
            title="No invoices yet"
            action={
              can(ctx.role, "import.run") ? (
                <Button asChild>
                  <Link href="/import">Import invoices</Link>
                </Button>
              ) : undefined
            }
          >
            Import a CSV or connect the API to get started.
          </EmptyState>
        )
      ) : (
        <>
          <div className="hidden md:block">
            <Table data-testid="invoice-table">
              <caption className="sr-only">Invoices</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="sticky left-0 z-(--z-raised)">
                    Number
                  </TableHead>
                  <TableHead scope="col">Customer</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Due</TableHead>
                  <TableHead scope="col">Age</TableHead>
                  <TableHead scope="col" className="text-right">
                    Balance
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-invoice={r.number}>
                    <TableCell className="sticky left-0 bg-panel">
                      <Link className="font-semibold text-link underline-offset-4 hover:underline" href={`/invoices/${r.id}`}>
                        <UntrustedText text={r.number} />
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      <UntrustedText text={r.customer_name} />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={r.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDate(r.due_on)}</TableCell>
                    <TableCell className="text-ink-muted">{BUCKET_TEXT[r.bucket] ?? r.bucket}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatMinor(r.balance, r.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-3 md:hidden" aria-label="Invoices">
            {rows.map((r) => (
              <li key={r.id} className="card-edge rounded-xl border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="t-heading-sm">
                    <Link className="text-link underline-offset-4 hover:underline" href={`/invoices/${r.id}`}>
                      <UntrustedText text={r.number} />
                    </Link>
                  </h2>
                  <StatusChip status={r.status} size="sm" />
                </div>
                <p className="t-body-sm text-ink-2">
                  <UntrustedText text={r.customer_name} />
                </p>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="t-caption text-ink-muted">Due {formatDate(r.due_on)}</span>
                  <span className="font-semibold tabular-nums">{formatMinor(r.balance, r.currency)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
        <span className="t-caption text-ink-muted">{rows.length > 0 ? `Showing ${rows.length} invoice${rows.length === 1 ? "" : "s"}` : ""}</span>
        <div className="flex gap-2">
          {f.after ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/invoices?${keep.toString()}`}>First page</Link>
            </Button>
          ) : null}
          {next ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/invoices?${new URLSearchParams([...keep, ["after", next]]).toString()}`}>
                Next page
                <ChevronRight aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
