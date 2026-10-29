import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@dueloop/authz";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { AiText, UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadInvoice } from "@/lib/data/invoices";
import { eventLabel } from "@/lib/event-labels";
import { formatMinor, minorIsPositive } from "@/lib/money";
import { NOT_RESUMABLE } from "@/lib/parked";
import { requirePermission } from "@/lib/session";
import { formatDate, formatInstant } from "@/lib/time";
import { resumeInvoice } from "./actions";
import { CancelPromiseForm } from "./cancel-promise-form";

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const ctx = await requirePermission("invoices.view");
  const { id } = await params;
  const d = await loadInvoice(ctx, id);
  if (!d) notFound();
  const { invoice: inv } = d;
  const tz = ctx.tenant.timezone;
  const activePromise = d.promises.find((p) => p.status === "active");
  const summary = (a: unknown): string | null =>
    a && typeof a === "object" && "summary" in a && typeof (a as { summary: unknown }).summary === "string" ? (a as { summary: string }).summary : null;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Invoice <UntrustedText text={inv.number} />
          </h1>
          <p className="text-sm text-muted-foreground">
            <Link className="underline" href={`/customers/${inv.customer_id}`}>
              <UntrustedText text={inv.customer_name} />
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={inv.status} />
          {can(ctx.role, "payments.record") && minorIsPositive(inv.balance) ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/payments/new?invoice=${inv.id}`}>Record a payment</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Balance" testId="balance">
          {formatMinor(inv.balance, inv.currency)}
        </Fact>
        <Fact label="Paid so far">{formatMinor(inv.amount_paid, inv.currency)}</Fact>
        <Fact label="Total">{formatMinor(inv.amount_total, inv.currency)}</Fact>
        <Fact label="Due">
          {formatDate(inv.due_on)}
          <span className="block text-xs text-muted-foreground">Issued {formatDate(inv.issued_on)}</span>
        </Fact>
        <Fact label="Reference code">{inv.reference_code}</Fact>
        <Fact label="Next action">{formatInstant(inv.next_action_at, tz)}</Fact>
        {inv.parked_reason ? <Fact label="Parked">{inv.parked_reason}</Fact> : null}
      </div>
      {inv.parked_reason ? (
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm">
            <p>Reminders for this invoice are on hold ({inv.parked_reason}).</p>
            {inv.parked_reason === "message_unknown" || inv.parked_reason === "send_ambiguous" ? (
              <p>
                A message may or may not have been sent. Check it on <Link href="/messages">Unknown sends</Link> first.
              </p>
            ) : inv.parked_reason === "awaiting_approval" ? (
              <p>
                A reminder is waiting on the <Link href="/approvals">Approvals</Link> page.
              </p>
            ) : !NOT_RESUMABLE.has(inv.parked_reason) && can(ctx.role, "invoices.resume") ? (
              <ActionForm action={resumeInvoice} label="Resume reminders">
                <input type="hidden" name="invoice" value={inv.id} />
                <p className="text-muted-foreground">Fix the cause first (for example the template, the sending account or the budget).</p>
                <Button type="submit" className="w-fit">
                  Resume reminders
                </Button>
              </ActionForm>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Promise</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {activePromise ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="active-promise">
              <span>Promised to pay by {formatDate(activePromise.promised_on)}</span>
              {can(ctx.role, "promises.cancel") ? <CancelPromiseForm promiseId={activePromise.id} /> : null}
            </div>
          ) : (
            <p className="text-muted-foreground">No active promise.</p>
          )}
          {d.promises.filter((p) => p.status !== "active").map((p) => (
            <p key={p.id} className="text-muted-foreground">
              {formatDate(p.promised_on)}: {p.status}
              {p.resolved_at ? ` (${formatInstant(p.resolved_at, tz)})` : ""}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Money received</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {d.receipts.length === 0 ? <p className="text-muted-foreground">Nothing received yet.</p> : null}
          {d.receipts.map((r) => (
            <p key={r.id}>
              {formatInstant(r.received_at, tz)}: {formatMinor(r.amount, r.currency)} by {r.method.replace("_", " ")} ({r.source})
            </p>
          ))}
          {d.credits.map((c) => (
            <p key={c.id} className="text-muted-foreground">
              Credit kept: {formatMinor(c.amount, c.currency)} ({formatInstant(c.created_at, tz)})
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tasks</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {d.tasks.length === 0 ? <p className="text-muted-foreground">No tasks.</p> : null}
          {d.tasks.map((t) => (
            <p key={t.id}>
              <Link className="underline" href={`/tasks/${t.id}`}>
                {t.type.replaceAll("_", " ")}
              </Link>{" "}
              · {t.status}
              {t.urgent ? " · urgent" : ""}
              {t.status === "open" && t.blocks_reminders_until ? ` · reminders paused until ${formatInstant(t.blocks_reminders_until, tz)}` : ""}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messages</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          {d.messages.length === 0 ? <p className="text-muted-foreground">No messages yet.</p> : null}
          {d.messages.map((m) => (
            <article key={m.id} className="grid gap-1 border-b pb-3 last:border-0" data-message={m.id}>
              <p className="text-xs text-muted-foreground">
                {m.direction === "in" ? "From the customer" : "To the customer"} · {m.channel} ·{" "}
                {formatInstant(m.sent_at ?? m.received_at ?? m.created_at, tz)}
                {m.direction === "out" && m.send_state ? ` · ${m.send_state}` : ""}
              </p>
              {m.subject ? (
                <p className="font-medium">
                  <UntrustedText text={m.subject} />
                </p>
              ) : null}
              <UntrustedText text={m.body} />
              {m.direction === "in" && summary(m.analysis) ? <AiText text={summary(m.analysis)} /> : null}
            </article>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 text-sm" data-testid="timeline">
            {d.events.map((e) => (
              <li key={e.id} className="grid grid-cols-[11rem_1fr] gap-3" data-event={e.type}>
                <time dateTime={e.created_at} className="text-muted-foreground tabular-nums">
                  {formatInstant(e.created_at, tz)}
                </time>
                <span>{eventLabel(e.type)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">Times are in {tz}.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, testId, children }: { label: string; testId?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{children}</p>
    </div>
  );
}
