import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@dueloop/authz";
import { UntrustedText } from "@/components/untrusted-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";
import { ProofDecisionForm } from "./proof-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function ProofPage({ params }: PageProps<"/proofs/[id]">) {
  const ctx = await requirePermission("proofs.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data: p, error } = await ctx.supabase
    .from("payment_proofs")
    .select("id, status, mime, size_bytes, original_name, created_at, duplicate_of, hints, decision_note, decided_at, invoice_id, invoices(number)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("could not load proof");
  if (!p) notFound();
  const bal = p.invoice_id
    ? await ctx.supabase.from("invoice_list").select("balance::text, currency, status").eq("tenant_id", ctx.tenant.id).eq("id", p.invoice_id).maybeSingle()
    : null;
  const hints = p.hints && typeof p.hints === "object" && !Array.isArray(p.hints) ? Object.entries(p.hints as Record<string, unknown>).slice(0, 10) : [];
  const fileUrl = `/proofs/${p.id}/file`;
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Payment proof</h1>
      <Card>
        <CardContent className="grid gap-1 pt-6 text-sm">
          <p>Status: {p.status}</p>
          <p>Received {formatInstant(p.created_at, ctx.tenant.timezone)}</p>
          <p>
            Invoice:{" "}
            {p.invoice_id ? (
              <Link className="underline" href={`/invoices/${p.invoice_id}`}>
                <UntrustedText text={p.invoices?.number} />
              </Link>
            ) : (
              "not linked to one invoice: record the payment on the right invoice instead"
            )}
            {bal?.data ? ` · balance ${formatMinor(bal.data.balance, bal.data.currency)} · ${bal.data.status}` : ""}
          </p>
          <p>
            File: <UntrustedText text={p.original_name ?? "(no name)"} /> ({p.mime}, {p.size_bytes} bytes)
          </p>
          {p.duplicate_of ? <p>The same file was received before (possible duplicate).</p> : null}
          {p.decision_note ? (
            <p>
              Decision note: <UntrustedText text={p.decision_note} />
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The file</CardTitle>
        </CardHeader>
        <CardContent>
          {p.mime === "application/pdf" ? (
            <a className="underline" href={fileUrl}>
              Download the PDF to view it
            </a>
          ) : (
            <img src={fileUrl} alt="Proof of payment sent by the customer (untrusted)" className="max-h-[32rem] max-w-full rounded border" />
          )}
        </CardContent>
      </Card>
      {hints.length ? (
        <div className="rounded-md border border-dashed p-3 text-sm" data-ai-untrusted="true">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            UNTRUSTED hints read from the image by software. They may be wrong or manipulated; never copy them, type from your bank statement.
          </p>
          <ul>
            {hints.map(([k, v]) => (
              <li key={k}>
                {k.replaceAll("_", " ")}: <UntrustedText text={typeof v === "string" || typeof v === "number" ? String(v) : "(not shown)"} max={200} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.status === "pending" && can(ctx.role, "proofs.decide") ? <ProofDecisionForm proofId={p.id} /> : null}
    </div>
  );
}
