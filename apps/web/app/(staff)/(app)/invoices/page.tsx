import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { can } from "@dueloop/authz";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip, STATUS_VISUAL } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LIST_BUCKETS, listInvoicePage, parseFilters, STATUSES } from "@/lib/data/invoices";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { formatDate } from "@/lib/time";
import { ALL, InvoiceListParams } from "@/domain/list-params";
import { ClearFiltersButton, FilterBar, FilterChips, FilterSearch, FilterSelect, FilterTabs, ListResults, ListScope } from "@/features/lists/list-scope";
import { queryOf } from "@/features/lists/query";
import { countText } from "@/features/lists/count-text";

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
  // The URL is the source of truth (§4.10): the page's view of it, parsed with Zod (bad values fall back) ...
  const p = InvoiceListParams.parse(sp);
  // ... and the query's own validated filters, unchanged (no contract change, D10).
  const f = parseFilters(sp);
  const { rows, next } = await listInvoicePage(ctx, f);
  const chips = [
    ...(f.q ? [{ key: "q", label: `Search: ${f.q}` }] : []),
    ...(p.status !== ALL ? [{ key: "status", label: STATUS_VISUAL[p.status].label }] : []),
    ...(p.bucket !== ALL ? [{ key: "bucket", label: `Age: ${BUCKET_TEXT[p.bucket] ?? p.bucket}` }] : []),
    ...(f.customer ? [{ key: "customer", label: `Customer: ${rows[0] ? rows[0].customer_name : "one customer"}` }] : []),
  ];
  const keep = new URLSearchParams();
  if (f.status) keep.set("status", f.status);
  if (f.bucket) keep.set("bucket", f.bucket);
  if (f.customer) keep.set("customer", f.customer);
  if (f.q) keep.set("q", f.q);
  const filtered = keep.size > 0;

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

      <ListScope query={queryOf(sp)}>
      <div className="grid gap-4">
        <FilterBar label="Filter invoices">
          <FilterSearch id="q" label="Search" placeholder="Number or customer" className="w-64" />
          <FilterSelect id="status" name="status" label="Status" className="w-44" options={STATUSES.map((st) => ({ value: st, label: STATUS_VISUAL[st].label }))} />
          <FilterSelect id="bucket" name="bucket" label="Age" className="w-40" options={LIST_BUCKETS.map((bk) => ({ value: bk, label: BUCKET_TEXT[bk] ?? bk }))} />
          {f.customer ? <input type="hidden" name="customer" value={f.customer} /> : null}
        </FilterBar>
        <FilterTabs name="status" label="Invoice status" value={f.status} tabs={TABS.map((t) => ({ label: t.label, value: t.status }))} />
        <FilterChips chips={chips} />
        <p role="status" className="sr-only" data-testid="list-count">
          {countText(rows.length, Boolean(next), "invoice", { filtered })}
        </p>
      </div>

      <ListResults>
      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title="Nothing matches" action={<ClearFiltersButton keys={["q", "status", "bucket", "customer"]} />}>
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
      </ListResults>
      </ListScope>
    </div>
  );
}
