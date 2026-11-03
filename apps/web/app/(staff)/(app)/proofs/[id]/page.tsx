import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@dueloop/authz";
import { UntrustedText } from "@/components/untrusted-text";
import { BackLink } from "@/components/ui/back-link";
import { Banner } from "@/components/ui/banner";
import { PageHeader } from "@/components/ui/page-header";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { formatInstant, tenantToday } from "@/lib/time";
import { ProofDecisionForm } from "./proof-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** S13 proof detail: the file, untrusted hints clearly labelled, the balance, and the two decisions. */
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
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/proofs">Proofs</BackLink>
        <PageHeader title="Payment proof" description="A proof never marks anything paid. Only a person who checked the bank statement confirms money." />
      </div>
      {p.duplicate_of ? <Banner tone="warning">The same file was received before (possible duplicate).</Banner> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <section aria-label="Facts" className="card-edge grid gap-2 rounded-xl border border-line bg-panel p-5 t-body-sm">
            <p>Status: {p.status}</p>
            <p>Received {formatInstant(p.created_at, ctx.tenant.timezone)}</p>
            <p>
              Invoice:{" "}
              {p.invoice_id ? (
                <Link className="font-semibold text-link underline" href={`/invoices/${p.invoice_id}`}>
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
            {p.decision_note ? (
              <p>
                Decision note: <UntrustedText text={p.decision_note} />
              </p>
            ) : null}
          </section>
          <section aria-labelledby="file-h" className="card-edge grid gap-3 rounded-xl border border-line bg-panel p-5">
            <h2 id="file-h" className="t-label">
              The file
            </h2>
            {p.mime === "application/pdf" ? (
              <a className="font-semibold text-link underline" href={fileUrl}>
                Download the PDF to view it
              </a>
            ) : (
              <img src={fileUrl} alt="Proof of payment sent by the customer (untrusted)" className="max-h-128 max-w-full rounded-md border border-line" />
            )}
          </section>
          {hints.length ? (
            <div className="grid gap-2 rounded-lg border border-dashed border-warning-line bg-warning-soft p-4 t-body-sm text-warning-ink" data-ai-untrusted="true">
              <p className="font-semibold">Read from the image — check before using</p>
              <p className="t-caption">
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
        </div>
        {p.status === "pending" && can(ctx.role, "proofs.decide") ? (
          <ProofDecisionForm proofId={p.id} currency={bal?.data?.currency ?? ctx.tenant.currency} today={tenantToday(ctx.tenant.timezone, new Date())} />
        ) : null}
      </div>
    </div>
  );
}
