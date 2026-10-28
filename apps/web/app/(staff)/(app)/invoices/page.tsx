import Link from "next/link";
import { can } from "@dueloop/authz";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LIST_BUCKETS, listInvoicePage, parseFilters, STATUSES } from "@/lib/data/invoices";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { formatDate } from "@/lib/time";

const BUCKET_TEXT: Record<string, string> = {
  not_due: "Not yet due",
  "1-30": "1-30 days",
  "31-60": "31-60 days",
  "61-90": "61-90 days",
  "91+": "Over 90 days",
  closed: "Closed",
};

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

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Invoices</h1>
        {can(ctx.role, "export.lists") ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/exports/invoices?${keep.toString()}`} download>
              Export CSV
            </a>
          </Button>
        ) : null}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm" role="search" aria-label="Filter invoices">
        <div className="grid gap-1">
          <label htmlFor="q">Search</label>
          <Input id="q" name="q" defaultValue={f.q ?? ""} placeholder="Number or customer" className="h-8 w-56" maxLength={60} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={f.status ?? ""} className="h-8 rounded-md border bg-background px-2">
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="bucket">Age</label>
          <select id="bucket" name="bucket" defaultValue={f.bucket ?? ""} className="h-8 rounded-md border bg-background px-2">
            <option value="">Any</option>
            {LIST_BUCKETS.map((b) => (
              <option key={b} value={b}>
                {BUCKET_TEXT[b]}
              </option>
            ))}
          </select>
        </div>
        {f.customer ? <input type="hidden" name="customer" value={f.customer} /> : null}
        <Button type="submit" size="sm">
          Filter
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/invoices">Clear</Link>
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No invoices match">Try a different filter, or import invoices.</EmptyState>
      ) : (
        <Table data-testid="invoice-table">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Number</TableHead>
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
                <TableCell>
                  <Link className="font-medium underline-offset-4 hover:underline" href={`/invoices/${r.id}`}>
                    <UntrustedText text={r.number} />
                  </Link>
                </TableCell>
                <TableCell>
                  <UntrustedText text={r.customer_name} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell>{formatDate(r.due_on)}</TableCell>
                <TableCell>{BUCKET_TEXT[r.bucket] ?? r.bucket}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMinor(r.balance, r.currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <nav aria-label="Pages" className="flex gap-2">
        {f.after ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/invoices?${keep.toString()}`}>First page</Link>
          </Button>
        ) : null}
        {next ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/invoices?${new URLSearchParams([...keep, ["after", next]]).toString()}`}>Next page</Link>
          </Button>
        ) : null}
      </nav>
    </div>
  );
}
