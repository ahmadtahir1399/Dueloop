import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, type AgeingBucket } from "@/lib/format";
import { isOutstanding, listInvoices } from "@/lib/invoices";
import { requireTenant } from "@/lib/session";

const BUCKETS: AgeingBucket[] = ["not_due", "1-30", "31-60", "61-90", "90+"];
const BUCKET_LABEL: Record<AgeingBucket, string> = {
  not_due: "Not yet due",
  "1-30": "1-30 days",
  "31-60": "31-60 days",
  "61-90": "61-90 days",
  "90+": "Over 90 days",
};

export default async function DashboardPage() {
  const ctx = await requireTenant();
  const invoices = await listInvoices(ctx);
  const outstanding = invoices.filter(isOutstanding);
  const overdue = outstanding.filter((i) => i.daysOverdue > 0);
  const currencies = [...new Set(outstanding.map((i) => i.currency))].sort();

  const sum = (xs: typeof invoices, currency: string) => xs.filter((i) => i.currency === currency).reduce((s, i) => s + i.balance, 0);

  if (invoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No invoices yet</CardTitle>
          <CardDescription>Import a CSV export from your accounting tool or spreadsheet to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/import">Import invoices</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Overdue invoices</CardDescription>
            <CardTitle className="text-3xl">{overdue.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Overdue amount</CardDescription>
            <CardTitle className="text-2xl">
              {currencies.length === 0 ? "—" : currencies.map((c) => formatMoney(sum(overdue, c), c)).join(" · ")}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Outstanding (all unpaid)</CardDescription>
            <CardTitle className="text-2xl">
              {currencies.length === 0 ? "—" : currencies.map((c) => formatMoney(sum(outstanding, c), c)).join(" · ")}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ageing</CardTitle>
          <CardDescription>Unpaid balances by how late they are, in {ctx.tenant.timezone} time.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                {currencies.map((c) => (
                  <TableHead key={c} className="text-right">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {BUCKETS.map((b) => {
                const rows = outstanding.filter((i) => i.bucket === b);
                return (
                  <TableRow key={b}>
                    <TableCell>{BUCKET_LABEL[b]}</TableCell>
                    <TableCell className="text-right tabular-nums">{rows.length}</TableCell>
                    {currencies.map((c) => (
                      <TableCell key={c} className="text-right tabular-nums">
                        {formatMoney(sum(rows, c), c)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Most overdue</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Days late</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...overdue]
                .sort((a, b) => b.daysOverdue - a.daysOverdue)
                .slice(0, 8)
                .map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link className="font-medium underline-offset-4 hover:underline" href={`/invoices/${i.id}`}>
                        {i.number}
                      </Link>
                    </TableCell>
                    <TableCell>{i.customerName}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.daysOverdue}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(i.balance, i.currency)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
