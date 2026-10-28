import Link from "next/link";
import { can } from "@dueloop/authz";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCustomerPage, parseCustomerFilters } from "@/lib/data/customers";
import { requirePermission } from "@/lib/session";

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const ctx = await requirePermission("customers.view");
  const f = parseCustomerFilters(await searchParams);
  const { rows, next } = await listCustomerPage(ctx, f);
  const keep = new URLSearchParams();
  if (f.q) keep.set("q", f.q);
  if (f.optedOut) keep.set("opted_out", "1");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Customers</h1>
        {can(ctx.role, "export.lists") ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/exports/customers?${keep.toString()}`} download>
              Export CSV
            </a>
          </Button>
        ) : null}
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 text-sm" role="search" aria-label="Filter customers">
        <div className="grid gap-1">
          <label htmlFor="q">Search</label>
          <Input id="q" name="q" defaultValue={f.q ?? ""} className="h-8 w-56" maxLength={60} />
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="opted_out" value="1" defaultChecked={f.optedOut} /> Opted out only
        </label>
        <Button type="submit" size="sm">
          Filter
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No customers match" />
      ) : (
        <Table data-testid="customer-table">
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
                  <Link className="font-medium underline-offset-4 hover:underline" href={`/customers/${c.id}`}>
                    <UntrustedText text={c.display_name} />
                  </Link>
                </TableCell>
                <TableCell>
                  <UntrustedText text={c.email} />
                </TableCell>
                <TableCell>{c.phone_e164 ?? "—"}</TableCell>
                <TableCell>{c.language}</TableCell>
                <TableCell>{c.opted_out ? <Badge variant="secondary">Opted out</Badge> : "Allowed"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {next ? (
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link href={`/customers?${new URLSearchParams([...keep, ["after", next]]).toString()}`}>Next page</Link>
        </Button>
      ) : null}
    </div>
  );
}
