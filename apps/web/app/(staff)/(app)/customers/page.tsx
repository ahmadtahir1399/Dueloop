import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { can } from "@dueloop/authz";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Chip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCustomerPage, parseCustomerFilters } from "@/lib/data/customers";
import { requirePermission } from "@/lib/session";
import { CustomerListParams } from "@/domain/list-params";
import { countText } from "@/features/lists/count-text";
import { ClearFiltersButton, FilterBar, FilterCheckbox, FilterChips, FilterSearch, ListResults, ListScope } from "@/features/lists/list-scope";
import { queryOf } from "@/features/lists/query";

/** S08 Customers (existing columns, C-15). */
export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const ctx = await requirePermission("customers.view");
  const sp = await searchParams;
  const p = CustomerListParams.parse(sp); // the page's view of the URL (§4.10)
  const f = parseCustomerFilters(sp); // the query's own filters, unchanged (D10)
  const { rows, next } = await listCustomerPage(ctx, f);
  const keep = new URLSearchParams();
  if (f.q) keep.set("q", f.q);
  if (f.optedOut) keep.set("opted_out", "1");
  const filtered = keep.size > 0;
  const chips = [...(p.q ? [{ key: "q", label: `Search: ${p.q}` }] : []), ...(p.opted_out ? [{ key: "opted_out", label: "Opted out only" }] : [])];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Customers"
        description="Who you remind, how to reach them, and whether they can be contacted."
        actions={
          can(ctx.role, "export.lists") ? (
            <Button asChild variant="outline">
              <a href={`/exports/customers?${keep.toString()}`} download>
                Export CSV
              </a>
            </Button>
          ) : undefined
        }
      />
      <ListScope query={queryOf(sp)}>
      <div className="grid gap-4">
        <FilterBar label="Filter customers">
          <FilterSearch id="q" label="Search" placeholder="Name or email" className="w-64" />
          <FilterCheckbox name="opted_out" label="Opted out only" />
        </FilterBar>
        <FilterChips chips={chips} />
        <p role="status" className="sr-only" data-testid="list-count">
          {countText(rows.length, Boolean(next), "customer")}
        </p>
      </div>
      <ListResults>
      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title="Nothing matches" action={<ClearFiltersButton keys={["q", "opted_out"]} />}>
            Try another search or clear the filters.
          </EmptyState>
        ) : (
          <EmptyState
            title="No customers yet"
            action={
              can(ctx.role, "import.run") ? (
                <Button asChild>
                  <Link href="/import">Import invoices</Link>
                </Button>
              ) : undefined
            }
          >
            Customers are added when you import invoices.
          </EmptyState>
        )
      ) : (
        <>
          <div className="hidden md:block">
            <Table data-testid="customer-table">
              <caption className="sr-only">Customers</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Email</TableHead>
                  <TableHead scope="col">Phone</TableHead>
                  <TableHead scope="col">Language</TableHead>
                  <TableHead scope="col">Messages</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link className="font-semibold text-link underline-offset-4 hover:underline" href={`/customers/${c.id}`}>
                        <UntrustedText text={c.display_name} />
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate">
                      <UntrustedText text={c.email} />
                    </TableCell>
                    <TableCell className="tabular-nums">{c.phone_e164 ?? "—"}</TableCell>
                    <TableCell>{c.language}</TableCell>
                    <TableCell>{c.opted_out ? <Chip tone="muted">Opted out</Chip> : <Chip tone="success">Allowed</Chip>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid gap-3 md:hidden" aria-label="Customers">
            {rows.map((c) => (
              <li key={c.id} className="card-edge grid gap-1 rounded-xl border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="t-heading-sm">
                    <Link className="text-link underline-offset-4 hover:underline" href={`/customers/${c.id}`}>
                      <UntrustedText text={c.display_name} />
                    </Link>
                  </h2>
                  {c.opted_out ? <Chip tone="muted" size="sm">Opted out</Chip> : null}
                </div>
                <p className="t-body-sm break-all text-ink-muted">
                  <UntrustedText text={c.email} />
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {next ? (
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link href={`/customers?${new URLSearchParams([...keep, ["after", next]]).toString()}`}>
            Next page
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      ) : null}
      </ListResults>
      </ListScope>
    </div>
  );
}
