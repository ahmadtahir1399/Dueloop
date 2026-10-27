import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { listInvoices } from "@/lib/invoices";
import { requireTenant } from "@/lib/session";
import { cn } from "@/lib/utils";

const FILTERS = ["all", "open", "overdue", "promised", "disputed", "escalated", "paid", "written_off", "cancelled"] as const;

export default async function InvoicesPage(props: PageProps<"/invoices">) {
  const params = await props.searchParams;
  const raw = typeof params.status === "string" ? params.status : "all";
  const filter = (FILTERS as readonly string[]).includes(raw) ? raw : "all";
  const ctx = await requireTenant();
  const all = await listInvoices(ctx);
  const invoices = filter === "all" ? all : all.filter((i) => i.status === filter);

  return (
    <Card>
      <CardHeader className="gap-4">
        <CardTitle>Invoices</CardTitle>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const n = f === "all" ? all.length : all.filter((i) => i.status === f).length;
            return (
              <Link
                key={f}
                href={f === "all" ? "/invoices" : `/invoices?status=${f}`}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs",
                  filter === f ? "border-foreground bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.replace("_", " ")} ({n})
              </Link>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No invoices here.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Days late</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link className="font-medium underline-offset-4 hover:underline" href={`/invoices/${i.id}`}>
                        {i.number}
                      </Link>
                    </TableCell>
                    <TableCell>{i.customerName}</TableCell>
                    <TableCell>{formatDate(i.dueOn)}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.daysOverdue > 0 ? i.daysOverdue : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(i.total, i.currency)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(i.balance, i.currency)}</TableCell>
                    <TableCell>
                      <StatusBadge status={i.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
