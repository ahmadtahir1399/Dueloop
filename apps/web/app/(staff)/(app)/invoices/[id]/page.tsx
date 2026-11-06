import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { can } from "@dueloop/authz";
import { ActionForm } from "@/components/action-form";
import { AiText, UntrustedText } from "@/components/untrusted-text";
import { aiSummaryOf } from "@/lib/ai-summary";
import { BackLink } from "@/components/ui/back-link";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CodeValue } from "@/components/ui/code-value";
import { PageHeader } from "@/components/ui/page-header";
import { Chip, StatusChip } from "@/components/ui/status-chip";
import { loadInvoice } from "@/lib/data/invoices";
import { eventLabel } from "@/lib/event-labels";
import { formatMinor, minorIsPositive } from "@/lib/money";
import { NOT_RESUMABLE, parkedFixHref, parkedFixPermission, parkedText } from "@/lib/parked";
import { requirePermission } from "@/lib/session";
import { formatDate, formatInstant } from "@/lib/time";
import { resumeInvoice } from "./actions";
import { CancelPromiseForm } from "./cancel-promise-form";

function Panel({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="card-edge grid content-start gap-3 rounded-xl border border-line bg-panel p-5" data-testid={testId} aria-label={title}>
      <h2 className="t-label">{title}</h2>
      {children}
    </section>
  );
}

/** S07 Invoice detail (§4.4): balance + status first, the pause reason and its next action, then history. */
export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const ctx = await requirePermission("invoices.view");
  const { id } = await params;
  const d = await loadInvoice(ctx, id);
  if (!d) notFound();
  const { invoice: inv } = d;
  const tz = ctx.tenant.timezone;
  const activePromise = d.promises.find((p) => p.status === "active");
  const canPay = can(ctx.role, "payments.record") && minorIsPositive(inv.balance);
  const parked = inv.parked_reason;
  const fixHref = parked ? parkedFixHref(parked) : null;
  const showFix = fixHref !== null && can(ctx.role, parkedFixPermission(fixHref));

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/invoices">Invoices</BackLink>
        <PageHeader
          title={
            <>
              <UntrustedText text={inv.number} /> <span className="text-ink-muted">·</span> <UntrustedText text={inv.customer_name} />
            </>
          }
          description={`Issued ${formatDate(inv.issued_on)} · Due ${formatDate(inv.due_on)} · Total ${formatMinor(inv.amount_total, inv.currency)}`}
          actions={
            canPay ? (
              <Button asChild>
                <Link href={`/payments/new?invoice=${inv.id}`}>Record a payment</Link>
              </Button>
            ) : undefined
          }
        />
      </div>

      {parked ? (
        <Banner
          tone="warning"
          title="Reminders paused."
          action={
            parked === "message_unknown" || parked === "send_ambiguous" ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/messages">Resolve</Link>
              </Button>
            ) : parked === "awaiting_approval" ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/approvals">Review</Link>
              </Button>
            ) : showFix ? (
              <Button asChild size="sm" variant="outline">
                <Link href={fixHref}>Open settings</Link>
              </Button>
            ) : undefined
          }
        >
          {parkedText(parked)}
          {!NOT_RESUMABLE.has(parked) && can(ctx.role, "invoices.resume") ? (
            <ActionForm action={resumeInvoice} label="Resume reminders" className="mt-3 grid gap-2">
              <input type="hidden" name="invoice" value={inv.id} />
              <p>Fix the cause first, then resume.</p>
              <Button type="submit" size="sm" variant="outline" className="w-fit">
                Resume reminders
              </Button>
            </ActionForm>
          ) : null}
        </Banner>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          <section aria-label="Balance" className="card-edge grid gap-4 rounded-xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1" data-testid="balance">
                <span className="t-label">Balance</span>
                <span className="t-display-md">{formatMinor(inv.balance, inv.currency)}</span>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip status={inv.status} />
                {inv.days_past_due > 0 && inv.status === "overdue" ? <span className="t-caption text-ink-muted tabular-nums">{inv.days_past_due} days</span> : null}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 t-body-sm sm:grid-cols-4">
              <div>
                <dt className="t-caption text-ink-muted">Paid so far</dt>
                <dd className="font-medium tabular-nums">{formatMinor(inv.amount_paid, inv.currency)}</dd>
              </div>
              <div>
                <dt className="t-caption text-ink-muted">Total</dt>
                <dd className="font-medium tabular-nums">{formatMinor(inv.amount_total, inv.currency)}</dd>
              </div>
              <div>
                <dt className="t-caption text-ink-muted">Next action</dt>
                <dd className="font-medium tabular-nums">{formatInstant(inv.next_action_at, tz)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="t-caption text-ink-muted">Reference code</dt>
                <dd>{inv.reference_code ? <CodeValue value={inv.reference_code} label="reference code" /> : "—"}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="timeline-h" className="card-edge grid gap-4 rounded-xl border border-line bg-panel p-5">
            <h2 id="timeline-h" className="t-label">
              Timeline
            </h2>
            <ol className="relative grid gap-4 border-l border-line pl-5" data-testid="timeline">
              {[...d.events].reverse().map((e) => (
                <li key={e.id} className="relative grid gap-0.5" data-event={e.type}>
                  <span aria-hidden="true" className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-panel bg-brand" />
                  <span className="t-body-sm font-semibold text-ink">{eventLabel(e.type)}</span>
                  <time dateTime={e.created_at} className="t-caption text-ink-muted">
                    {formatInstant(e.created_at, tz)}
                  </time>
                </li>
              ))}
            </ol>
            <p className="t-caption text-ink-muted">Times are in {tz}.</p>
          </section>

          <section aria-labelledby="messages-h" className="card-edge grid gap-4 rounded-xl border border-line bg-panel p-5">
            <h2 id="messages-h" className="t-label">
              Messages
            </h2>
            {d.messages.length === 0 ? <p className="t-body-sm text-ink-muted">No messages yet.</p> : null}
            <div className="grid gap-3">
              {d.messages.map((m) => (
                <article
                  key={m.id}
                  data-message={m.id}
                  className={
                    m.direction === "in"
                      ? "grid max-w-[85%] gap-1 justify-self-start rounded-lg bg-sunken p-3 t-body-sm"
                      : m.send_state === "unknown"
                        ? "grid max-w-[85%] gap-1 justify-self-end rounded-lg border border-warning-line bg-brand-soft p-3 t-body-sm"
                        : "grid max-w-[85%] gap-1 justify-self-end rounded-lg bg-brand-soft p-3 t-body-sm"
                  }
                >
                  <p className="t-caption text-ink-muted">
                    {m.direction === "in" ? "From the customer" : "To the customer"} · {m.channel} · {formatInstant(m.sent_at ?? m.received_at ?? m.created_at, tz)}
                    {m.direction === "out" && m.send_state ? ` · ${m.send_state === "unknown" ? "result unknown" : m.send_state}` : ""}
                  </p>
                  {m.subject ? (
                    <p className="font-semibold">
                      <UntrustedText text={m.subject} />
                    </p>
                  ) : null}
                  <UntrustedText text={m.body} />
                  {m.direction === "in" && aiSummaryOf(m.analysis) ? <AiText text={aiSummaryOf(m.analysis)} /> : null}
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="grid content-start gap-4">
          <Panel title="Customer">
            <Link className="inline-flex items-center gap-1 t-heading-sm text-link hover:underline" href={`/customers/${inv.customer_id}`}>
              <UntrustedText text={inv.customer_name} />
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          </Panel>
          <Panel title="Promise">
            {activePromise ? (
              <div className="grid gap-3" data-testid="active-promise">
                <p className="t-body-sm">
                  <Chip tone="info">Promised</Chip> <span className="ml-1">to pay by {formatDate(activePromise.promised_on)}</span>
                </p>
                {can(ctx.role, "promises.cancel") ? <CancelPromiseForm promiseId={activePromise.id} /> : null}
              </div>
            ) : (
              <p className="t-body-sm text-ink-muted">No active promise.</p>
            )}
            {d.promises
              .filter((p) => p.status !== "active")
              .map((p) => (
                <p key={p.id} className="t-caption text-ink-muted">
                  {formatDate(p.promised_on)}: {p.status}
                  {p.resolved_at ? ` (${formatInstant(p.resolved_at, tz)})` : ""}
                </p>
              ))}
          </Panel>
          <Panel title="Money received">
            {d.receipts.length === 0 ? <p className="t-body-sm text-ink-muted">Nothing received yet.</p> : null}
            <ul className="grid gap-2">
              {d.receipts.map((r) => (
                <li key={r.id} className="grid t-body-sm">
                  <span className="font-semibold tabular-nums">{formatMinor(r.amount, r.currency)}</span>
                  <span className="t-caption text-ink-muted">
                    {formatInstant(r.received_at, tz)} · {r.method.replace("_", " ")} ({r.source})
                  </span>
                </li>
              ))}
              {d.credits.map((c) => (
                <li key={c.id} className="t-caption text-ink-muted">
                  Credit kept: {formatMinor(c.amount, c.currency)} ({formatInstant(c.created_at, tz)})
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Tasks">
            {d.tasks.length === 0 ? <p className="t-body-sm text-ink-muted">No tasks.</p> : null}
            <ul className="grid gap-2">
              {d.tasks.map((t) => (
                <li key={t.id} className="t-body-sm">
                  <Link className="font-medium text-link underline" href={`/tasks/${t.id}`}>
                    {t.type.replaceAll("_", " ")}
                  </Link>{" "}
                  · {t.status}
                  {t.urgent ? " · urgent" : ""}
                  {t.status === "open" && t.blocks_reminders_until ? ` · reminders paused until ${formatInstant(t.blocks_reminders_until, tz)}` : ""}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
