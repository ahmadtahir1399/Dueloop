import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@dueloop/authz";
import { AiText, UntrustedText } from "@/components/untrusted-text";
import { aiSummaryOf } from "@/lib/ai-summary";
import { BackLink } from "@/components/ui/back-link";
import { Banner } from "@/components/ui/banner";
import { PageHeader } from "@/components/ui/page-header";
import { Chip } from "@/components/ui/status-chip";
import { requirePermission } from "@/lib/session";
import { taskVisual } from "@/lib/task-labels";
import { formatInstant } from "@/lib/time";
import { CopyDraft, TaskForm } from "./task-form";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Detail values worth showing; free text from replies or models is never shown from here (only typed facts). */
function facts(details: unknown): [string, string][] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  return Object.entries(details as Record<string, unknown>)
    .filter(([k, v]) => !/summary|body|text|email|phone|draft|raw/i.test(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
    .slice(0, 20)
    .map(([k, v]) => [k.replaceAll("_", " "), String(v).slice(0, 200)]);
}

/** S12 task detail: facts, the AI suggestion labelled as such, and the Resolve form (F08). */
export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const ctx = await requirePermission("tasks.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data: t, error } = await ctx.supabase
    .from("tasks")
    .select("id, type, reason, status, urgent, details, draft_reply, created_at, blocks_reminders_until, resolved_at, resolved_by, resolution_note, invoice_id, invoices(number), customers(display_name), message_id, messages(analysis)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("could not load task");
  if (!t) notFound();
  const tz = ctx.tenant.timezone;
  const summary = aiSummaryOf(t.messages?.analysis);
  const v = taskVisual(t.type);
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/tasks">Tasks</BackLink>
        <PageHeader title={v.label}>
          <div className="flex flex-wrap gap-2">
            <Chip tone={v.tone}>{v.label}</Chip>
            {t.urgent ? <Chip tone="error">urgent</Chip> : null}
            <Chip tone={t.status === "open" ? "neutral" : "success"}>{t.status}</Chip>
          </div>
        </PageHeader>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-4">
          <section aria-label="Facts" className="card-edge grid gap-2 rounded-xl border border-line bg-panel p-5 t-body-sm">
            {t.invoice_id ? (
              <p>
                <span className="text-ink-muted">Invoice </span>
                <Link className="font-semibold text-link underline" href={`/invoices/${t.invoice_id}`}>
                  <UntrustedText text={t.invoices?.number} />
                </Link>
              </p>
            ) : null}
            <p>
              <span className="text-ink-muted">Customer </span>
              <UntrustedText text={t.customers?.display_name} />
            </p>
            {t.reason ? (
              <p>
                <span className="text-ink-muted">Reason </span>
                {t.reason.replaceAll("_", " ")}
              </p>
            ) : null}
            <p>
              <span className="text-ink-muted">Created </span>
              {formatInstant(t.created_at, tz)}
            </p>
            {facts(t.details).map(([k, val]) => (
              <p key={k}>
                <span className="text-ink-muted">{k} </span>
                <UntrustedText text={val} />
              </p>
            ))}
            {t.resolved_at ? (
              <p>
                Resolved {formatInstant(t.resolved_at, tz)}: <UntrustedText text={t.resolution_note} />
              </p>
            ) : null}
          </section>
          {t.status === "open" && t.blocks_reminders_until ? (
            <Banner tone="warning" testId="blocks-until">
              Reminders for this invoice are paused until {formatInstant(t.blocks_reminders_until, tz)}.
            </Banner>
          ) : null}
          {summary ? <AiText text={summary} /> : null}
          {t.draft_reply ? (
            <section aria-labelledby="draft-h" className="card-edge grid gap-3 rounded-xl border border-line bg-panel p-5">
              <h2 id="draft-h" className="t-heading-sm">
                Suggestion — not applied
              </h2>
              <p className="t-caption text-ink-muted">Copy it into your own email if it helps. Nothing is sent from here.</p>
              <CopyDraft text={t.draft_reply} />
            </section>
          ) : null}
        </div>
        {can(ctx.role, "tasks.resolve") ? <TaskForm taskId={t.id} open={t.status === "open"} /> : null}
      </div>
    </div>
  );
}
