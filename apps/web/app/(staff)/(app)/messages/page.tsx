import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";
import { ReconcileForm } from "./reconcile-form";

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
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Messages in an unknown state</h1>
      <div className="grid gap-1 text-sm text-muted-foreground">
        <p>
          The provider did not confirm these sends, and they may or may not have reached the customer. They are never resent
          automatically.
        </p>
        <p>
          Check the provider&apos;s log, or ask the customer. Then record what happened. &quot;Sent&quot; moves the reminder schedule on.
          &quot;Not sent&quot; lets the same reminder be tried once more, with the same key.
        </p>
      </div>
      {rows.length === 0 ? <EmptyState title="Nothing to reconcile" /> : null}
      {rows.map((m) => {
        const inv = m.message_invoices?.[0];
        return (
          <article key={m.id} className="grid gap-2 rounded-lg border p-4 text-sm" data-message={m.id}>
            <p>
              {m.purpose} by {m.channel}, attempted {formatInstant(m.pending_since, ctx.tenant.timezone)}
              {inv ? (
                <>
                  {" "}
                  for invoice{" "}
                  <Link className="underline" href={`/invoices/${inv.invoice_id}`}>
                    <UntrustedText text={inv.invoices?.number} />
                  </Link>
                </>
              ) : null}
            </p>
            <ReconcileForm messageId={m.id} />
          </article>
        );
      })}
    </div>
  );
}
