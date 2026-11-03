import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Banner } from "@/components/ui/banner";
import { CodeValue } from "@/components/ui/code-value";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";
import { ReconcileForm } from "./reconcile-form";

const CHANNEL_LABEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", sms: "SMS" };

/** S14 Unknown sends (rule 17: a message in an unknown state is never resent automatically; a person reconciles it). */
export default async function UnknownMessagesPage() {
  const ctx = await requirePermission("messages.reconcile");
  const { data, error } = await ctx.supabase
    .from("messages")
    .select("id, channel, purpose, pending_since, idempotency_key, message_invoices(invoice_id, invoices(number))")
    .eq("tenant_id", ctx.tenant.id)
    .eq("send_state", "unknown")
    .order("pending_since")
    .limit(200);
  if (error) throw new Error("could not load messages");
  const rows = data ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Unknown sends"
        description="The provider did not confirm these sends, and they may or may not have reached the customer. Check the provider's log, or ask the customer, then record what happened."
      />
      {rows.length === 0 ? (
        <EmptyState title="No unknown sends" icon={CircleCheck}>
          Good news: every send has a known result.
        </EmptyState>
      ) : (
        <div className="grid gap-4">
          <Banner tone="info">&quot;It was sent&quot; moves the reminder schedule on. &quot;It was not sent&quot; lets the same reminder be tried once more, with the same key.</Banner>
          {rows.map((m) => {
            const inv = m.message_invoices?.[0];
            return (
              <article key={m.id} className="card-edge grid gap-4 rounded-xl border border-line bg-panel p-5" data-message={m.id} aria-label={`Unknown send ${m.purpose}`}>
                <div className="grid gap-1">
                  <h2 className="t-heading-sm" tabIndex={-1}>
                    {m.purpose} · {CHANNEL_LABEL[m.channel] ?? m.channel}
                    {inv ? (
                      <>
                        {" "}
                        for invoice{" "}
                        <Link className="text-link underline" href={`/invoices/${inv.invoice_id}`}>
                          <UntrustedText text={inv.invoices?.number} />
                        </Link>
                      </>
                    ) : null}
                  </h2>
                  <p className="t-caption text-ink-muted">Attempted {formatInstant(m.pending_since, ctx.tenant.timezone)}</p>
                </div>
                {m.idempotency_key ? (
                  <p className="flex flex-wrap items-center gap-2 t-body-sm">
                    <span className="text-ink-muted">Idempotency key</span>
                    <CodeValue value={m.idempotency_key} label="idempotency key" />
                  </p>
                ) : null}
                <p className="t-body-sm font-medium">Dueloop will never resend this automatically.</p>
                <ReconcileForm messageId={m.id} />
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
