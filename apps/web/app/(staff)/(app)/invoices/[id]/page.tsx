import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { daysOverdue, formatDate, formatMoney, formatTimestamp } from "@/lib/format";
import { requireTenant } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function describe(type: string, payload: unknown): string {
  const p = (payload ?? {}) as { row?: number; changes?: Record<string, { from: unknown; to: unknown }> };
  if (type === "InvoiceImported") return `Imported from a CSV file${p.row ? ` (line ${p.row})` : ""}.`;
  if (type === "InvoiceImportUpdated" && p.changes) {
    return `Updated by an import: ${Object.entries(p.changes)
      .map(([field, c]) => `${field} ${String(c.from)} → ${String(c.to)}`)
      .join(", ")}.`;
  }
  return type;
}

export default async function InvoicePage(props: PageProps<"/invoices/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  const { supabase, tenant } = await requireTenant();

  const [invoiceRes, balanceRes, paymentsRes, eventsRes] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, status, issued_on, due_on, promised_on, amount_total, currency, reference_code, created_at, customers(id, display_name, email, phone_e164, opted_out)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("invoice_balances").select("amount_paid, balance").eq("invoice_id", id).maybeSingle(),
    supabase.from("payments").select("id, amount, currency, method, provider_ref, paid_at").eq("invoice_id", id).order("paid_at"),
    supabase.from("invoice_events").select("id, type, payload, created_at").eq("invoice_id", id).order("created_at"),
  ]);
  const invoice = invoiceRes.data;
  if (!invoice) notFound();
  const paid = balanceRes.data?.amount_paid ?? 0;
  const balance = balanceRes.data?.balance ?? invoice.amount_total;
  const late = daysOverdue(invoice.due_on, tenant.timezone);
  const customer = invoice.customers;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/invoices" className="text-sm text-muted-foreground hover:text-foreground">
          ← Invoices
        </Link>
        <h1 className="text-2xl font-semibold">{invoice.number}</h1>
        <StatusBadge status={invoice.status} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Balance</CardDescription>
            <CardTitle className="text-2xl">{formatMoney(balance, invoice.currency)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {formatMoney(invoice.amount_total, invoice.currency)} total · {formatMoney(paid, invoice.currency)} paid
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Due</CardDescription>
            <CardTitle className="text-2xl">{formatDate(invoice.due_on)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Issued {formatDate(invoice.issued_on)}
            {late > 0 && balance > 0 ? ` · ${late} days late` : ""}
            {invoice.promised_on ? ` · promised for ${formatDate(invoice.promised_on)}` : ""}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Bank transfer reference</CardDescription>
            <CardTitle className="font-mono text-2xl tracking-wider">{invoice.reference_code}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">The code the customer quotes when paying.</CardContent>
        </Card>
      </div>

      {customer ? (
        <Card>
          <CardHeader>
            <CardTitle>{customer.display_name}</CardTitle>
            <CardDescription>
              {[customer.email, customer.phone_e164].filter(Boolean).join(" · ") || "No contact details"}
              {customer.opted_out ? " · opted out of messages" : ""}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {(paymentsRes.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No confirmed payments yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paid</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(paymentsRes.data ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatTimestamp(p.paid_at, tenant.timezone)}</TableCell>
                    <TableCell>{p.method.replace("_", " ")}</TableCell>
                    <TableCell className="font-mono text-xs">{p.provider_ref}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(p.amount, p.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>Every event recorded for this invoice. Events can never be edited.</CardDescription>
        </CardHeader>
        <CardContent>
          {(eventsRes.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <ol className="grid gap-3">
              {(eventsRes.data ?? []).map((e, idx) => (
                <li key={e.id} className="grid gap-1">
                  {idx > 0 ? <Separator className="mb-2" /> : null}
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{e.type}</span>
                    <span className="text-xs text-muted-foreground">{formatTimestamp(e.created_at, tenant.timezone)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{describe(e.type, e.payload)}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
