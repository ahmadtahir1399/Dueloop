import Link from "next/link";
import { ListChecks } from "lucide-react";
import { can } from "@dueloop/authz";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Banner } from "@/components/ui/banner";
import { CountBadge } from "@/components/ui/count-badge";
import { PageHeader } from "@/components/ui/page-header";
import { Chip } from "@/components/ui/status-chip";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";
import { loadPendingApprovals } from "@/lib/data/approvals";
import { ActionForm, BulkApproveForm } from "./forms";

const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
/** Pending approvals expire after 7 days (private.expire_approvals(interval '7 days'), migration 0008). */
const EXPIRES_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHANNEL_LABEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", sms: "SMS" };

function expiresIn(requestedAt: string, now: number): string {
  const left = Date.parse(requestedAt) + EXPIRES_AFTER_MS - now;
  if (left <= 0) return "expires now";
  const days = Math.ceil(left / DAY_MS);
  return days <= 1 ? "expires today" : `expires in ${days} days`;
}

/**
 * S11 Approvals (§4.5 Queue template): an index sorted by soonest expiry, then each item with the facts, the exact
 * message and exactly two decisions. Collectors see the queue read-only (Q8: approvals.view yes, decide no).
 */
export default async function ApprovalsPage() {
  const ctx = await requirePermission("approvals.view");
  const { rows, previews } = await loadPendingApprovals(ctx);
  const mayDecide = can(ctx.role, "approvals.decide");
  const now = Date.now();
  const sorted = [...rows].sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            Approvals <CountBadge count={rows.length} className="h-7 min-w-7 t-body-sm" />
          </span>
        }
        description="Each approval covers one exact message. Approvals expire after 7 days. The system still checks every reminder again (payment, promise, opt-out, quiet hours, kill switch) right before it is sent."
      />
      {!mayDecide && rows.length > 0 ? <Banner tone="info">You can see what is waiting. Owners and accountants approve or reject.</Banner> : null}
      {rows.length === 0 ? (
        <EmptyState title="Nothing waiting for approval" icon={ListChecks}>
          New reminders that need approval will appear here.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <nav aria-label="Waiting approvals" className="lg:sticky lg:top-24 lg:self-start">
            <ol className="card-edge divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
              {sorted.map((a) => (
                <li key={a.id}>
                  <a href={`#approval-${a.id}`} className="grid gap-0.5 px-4 py-3 transition-colors-fast hover:bg-sunken">
                    <span className="t-body-sm font-semibold text-ink">
                      <UntrustedText text={a.invoices?.customers?.display_name ?? "Unknown customer"} /> · <UntrustedText text={a.invoices?.number} />
                    </span>
                    <span className="t-caption text-ink-muted">
                      {CHANNEL_LABEL[a.channel] ?? a.channel} · {expiresIn(a.requested_at, now)}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="grid content-start gap-4">
            {sorted.map((a) => {
              const p = previews.get(a.id);
              const stale = now - Date.parse(a.requested_at) > STALE_AFTER_MS || !["open", "overdue", "escalated"].includes(a.invoices?.status ?? "");
              return (
                <article
                  key={a.id}
                  id={`approval-${a.id}`}
                  data-approval={a.id}
                  aria-labelledby={`approval-h-${a.id}`}
                  className="card-edge grid gap-4 rounded-xl border border-line bg-panel p-5"
                >
                  <div className="grid gap-1">
                    <h2 id={`approval-h-${a.id}`} tabIndex={-1} className="t-heading-md text-ink">
                      {CHANNEL_LABEL[a.channel] ?? a.channel} reminder · <UntrustedText text={a.invoices?.customers?.display_name ?? "Unknown customer"} />
                    </h2>
                    <p className="flex flex-wrap items-center gap-2 t-body-sm text-ink-muted">
                      <span>
                        Invoice{" "}
                        <Link className="font-semibold text-link underline" href={`/invoices/${a.invoice_id}`}>
                          <UntrustedText text={a.invoices?.number} />
                        </Link>
                      </span>
                      <span>· requested {formatInstant(a.requested_at, ctx.tenant.timezone)}</span>
                      <Chip tone="info" size="sm">
                        {expiresIn(a.requested_at, now)}
                      </Chip>
                      {stale ? (
                        <Chip tone="warning" size="sm">
                          stale: will be re-checked before sending
                        </Chip>
                      ) : null}
                      {a.body_override ? (
                        <Chip tone="neutral" size="sm">
                          edited
                        </Chip>
                      ) : null}
                    </p>
                  </div>
                  <Banner tone="info">Approving sends this message at the next allowed time. Quiet hours and holidays apply.</Banner>
                  <div className="grid gap-2 rounded-lg border border-line bg-sunken p-4 t-body-sm">
                    <p className="t-label">Message preview · exactly as the customer sees it</p>
                    {p?.ok ? (
                      <>
                        {p.subject ? (
                          <p className="font-semibold">
                            Subject: <UntrustedText text={p.subject} />
                          </p>
                        ) : null}
                        <UntrustedText text={p.body} />
                        <p className="t-caption text-ink-muted">Preview from the real renderer. The payment link is added at send time.</p>
                      </>
                    ) : (
                      <p className="text-ink-muted">No preview: {p?.reason ?? "unavailable"}. The worker will not send it in this state.</p>
                    )}
                  </div>
                  <p className="t-caption text-ink-muted">This approval covers this one message only.</p>
                  {mayDecide ? <ActionForm approvalId={a.id} subject={p?.subject ?? ""} body={a.body_override ?? stripFooter(p?.body ?? "")} channel={a.channel} /> : null}
                </article>
              );
            })}
            {mayDecide ? <BulkApproveForm ids={sorted.map((r) => ({ id: r.id, label: `${r.invoices?.number ?? "?"} (${r.channel})` }))} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** The editable part is the body without the footer (the footer is always re-appended by the sender). */
function stripFooter(body: string): string {
  const i = body.lastIndexOf("\n\n--\n");
  return i >= 0 ? body.slice(0, i) : body;
}
