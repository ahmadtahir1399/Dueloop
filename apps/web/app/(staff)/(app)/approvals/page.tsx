import Link from "next/link";
import { can } from "@dueloop/authz";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";
import { loadPendingApprovals } from "@/lib/data/approvals";
import { ActionForm, BulkApproveForm } from "./forms";

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export default async function ApprovalsPage() {
  const ctx = await requirePermission("approvals.view");
  const { rows, previews } = await loadPendingApprovals(ctx);
  const mayDecide = can(ctx.role, "approvals.decide");
  const groups = new Map<string, { name: string; items: typeof rows }>();
  for (const a of rows) {
    const key = a.invoices?.customer_id ?? "unknown";
    const g = groups.get(key) ?? { name: a.invoices?.customers?.display_name ?? "Unknown customer", items: [] };
    g.items.push(a);
    groups.set(key, g);
  }
  const now = Date.now();

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Approvals</h1>
      <p className="text-sm text-muted-foreground">
        Approving authorises one reminder. The system still checks it again (payment, promise, opt-out, quiet hours, kill switch)
        right before it is sent.
      </p>
      {rows.length === 0 ? <EmptyState title="Nothing waiting for approval" /> : null}
      {mayDecide && rows.length > 0 ? <BulkApproveForm ids={rows.map((r) => ({ id: r.id, label: `${r.invoices?.number ?? "?"} (${r.channel})` }))} /> : null}
      {[...groups.entries()].map(([key, g]) => (
        <section key={key} className="grid gap-3 rounded-lg border p-4" aria-label={`Approvals for ${g.name}`}>
          <h2 className="font-semibold">
            <UntrustedText text={g.name} />
          </h2>
          {g.items.map((a) => {
            const p = previews.get(a.id);
            const stale = now - Date.parse(a.requested_at) > STALE_AFTER_MS || !["open", "overdue", "escalated"].includes(a.invoices?.status ?? "");
            return (
              <article key={a.id} className="grid gap-2 border-t pt-3" data-approval={a.id}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link className="font-medium underline" href={`/invoices/${a.invoice_id}`}>
                    <UntrustedText text={a.invoices?.number} />
                  </Link>
                  <Badge variant="outline">{a.channel}</Badge>
                  <span className="text-muted-foreground">requested {formatInstant(a.requested_at, ctx.tenant.timezone)}</span>
                  {stale ? <Badge variant="secondary">stale: will be re-checked before sending</Badge> : null}
                  {a.body_override ? <Badge variant="secondary">edited</Badge> : null}
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-sm">
                  {p?.ok ? (
                    <>
                      {p.subject ? (
                        <p className="font-medium">
                          <UntrustedText text={p.subject} />
                        </p>
                      ) : null}
                      <UntrustedText text={p.body} />
                      <p className="mt-2 text-xs text-muted-foreground">Preview from the real renderer. The payment link is added at send time.</p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">No preview: {p?.reason ?? "unavailable"}. The worker will not send it in this state.</p>
                  )}
                </div>
                {mayDecide ? <ActionForm approvalId={a.id} subject={p?.subject ?? ""} body={a.body_override ?? stripFooter(p?.body ?? "")} channel={a.channel} /> : null}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** The editable part is the body without the footer (the footer is always re-appended by the sender). */
function stripFooter(body: string): string {
  const i = body.lastIndexOf("\n\n--\n");
  return i >= 0 ? body.slice(0, i) : body;
}
