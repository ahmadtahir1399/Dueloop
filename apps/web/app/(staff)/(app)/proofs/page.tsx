import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";

export default async function ProofsPage({ searchParams }: PageProps<"/proofs">) {
  const ctx = await requirePermission("proofs.view");
  const sp = await searchParams;
  const status = sp.status === "confirmed" || sp.status === "rejected" ? sp.status : "pending";
  const { data, error } = await ctx.supabase
    .from("payment_proofs")
    .select("id, status, mime, size_bytes, original_name, created_at, duplicate_of, invoice_id, invoices(number), customers(display_name)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", status)
    .order("created_at")
    .order("id")
    .limit(200);
  if (error) throw new Error("could not load proofs");
  const rows = data ?? [];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Payment proofs</h1>
        <nav aria-label="Proof status" className="flex gap-2 text-sm">
          {(["pending", "confirmed", "rejected"] as const).map((s) => (
            <Link key={s} href={s === "pending" ? "/proofs" : `/proofs?status=${s}`} aria-current={s === status ? "page" : undefined} className={s === status ? "font-semibold" : "underline"}>
              {s}
            </Link>
          ))}
        </nav>
      </div>
      <p className="text-sm text-muted-foreground">A proof never marks anything paid. Only a human who checked the bank statement confirms money.</p>
      {rows.length === 0 ? (
        <EmptyState title={`No ${status} proofs`} />
      ) : (
        <Table data-testid="proof-table">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Received</TableHead>
              <TableHead scope="col">Invoice</TableHead>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col">File</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link className="underline" href={`/proofs/${p.id}`}>
                    {formatInstant(p.created_at, ctx.tenant.timezone)}
                  </Link>
                  {p.duplicate_of ? (
                    <Badge variant="secondary" className="ml-2">
                      possible duplicate
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{p.invoices?.number ? <UntrustedText text={p.invoices.number} /> : "not linked"}</TableCell>
                <TableCell>
                  <UntrustedText text={p.customers?.display_name} />
                </TableCell>
                <TableCell>
                  <UntrustedText text={p.original_name ?? "(no name)"} /> · {p.mime} · {p.size_bytes} bytes
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
