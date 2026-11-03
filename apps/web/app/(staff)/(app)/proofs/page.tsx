import Link from "next/link";
import { FileCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { PageHeader } from "@/components/ui/page-header";
import { Chip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";
import { cn } from "cn";

const LABEL = { pending: "To check", confirmed: "Confirmed", rejected: "Rejected" } as const;

/** S13 Proofs: oldest first. */
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
    <div className="grid gap-6">
      <PageHeader title="Payment proofs" description="A proof never marks anything paid. Only a human who checked the bank statement confirms money." />
      <nav aria-label="Proof status" className="flex gap-1 border-b border-line">
        {(["pending", "confirmed", "rejected"] as const).map((s) => (
          <Link
            key={s}
            href={s === "pending" ? "/proofs" : `/proofs?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={cn("inline-flex min-h-11 items-center border-b-2 px-3 t-body-sm font-medium", s === status ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink")}
          >
            {LABEL[s]}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title={status === "pending" ? "No proofs to check" : `No ${status} proofs`} icon={FileCheck}>
          {status === "pending" ? "Customers can upload proof from their pay page." : null}
        </EmptyState>
      ) : (
        <Table data-testid="proof-table">
          <caption className="sr-only">Payment proofs</caption>
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
                  <Link className="font-semibold text-link underline tabular-nums" href={`/proofs/${p.id}`}>
                    {formatInstant(p.created_at, ctx.tenant.timezone)}
                  </Link>
                  {p.duplicate_of ? (
                    <Chip tone="warning" size="sm" className="ml-2">
                      possible duplicate
                    </Chip>
                  ) : null}
                </TableCell>
                <TableCell>{p.invoices?.number ? <UntrustedText text={p.invoices.number} /> : "not linked"}</TableCell>
                <TableCell className="max-w-56 truncate">
                  <UntrustedText text={p.customers?.display_name} />
                </TableCell>
                <TableCell className="max-w-64 truncate text-ink-muted">
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
