import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { isOutstanding, listInvoices } from "@/lib/invoices";
import { requireTenant } from "@/lib/session";

export default async function CustomersPage() {
  const ctx = await requireTenant();
  const [customersRes, invoices] = await Promise.all([
    ctx.supabase
      .from("customers")
      .select("id, display_name, email, phone_e164, external_id, opted_out, language")
      .eq("tenant_id", ctx.tenant.id)
      .order("display_name"),
    listInvoices(ctx),
  ]);
  const customers = customersRes.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customers ({customers.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {customers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No customers yet. Importing invoices creates them.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Open invoices</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => {
                  const mine = invoices.filter((i) => i.customerId === c.id && isOutstanding(i));
                  const byCurrency = new Map<string, number>();
                  for (const i of mine) byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0) + i.balance);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="font-medium">{c.display_name}</span>
                        {c.opted_out ? (
                          <Badge variant="secondary" className="ml-2">
                            opted out
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{c.email ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{c.phone_e164 ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{mine.length}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {byCurrency.size === 0
                          ? "—"
                          : [...byCurrency.entries()].map(([cur, v]) => formatMoney(v, cur)).join(" · ")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
