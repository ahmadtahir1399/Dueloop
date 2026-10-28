import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@dueloop/authz";
import { AiText, UntrustedText } from "@/components/untrusted-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/session";
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

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const ctx = await requirePermission("tasks.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { data: t, error } = await ctx.supabase
    .from("tasks")
    .select("id, type, reason, status, urgent, details, draft_reply, created_at, blocks_reminders_until, resolved_at, resolved_by, resolution_note, invoice_id, invoices(number), customers(display_name), message_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("could not load task");
  if (!t) notFound();
  const tz = ctx.tenant.timezone;
  const summary = t.details && typeof t.details === "object" && !Array.isArray(t.details) && typeof (t.details as Record<string, unknown>).summary === "string" ? String((t.details as Record<string, unknown>).summary) : null;
  return (
    <div className="grid gap-4">
      <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
        {t.type.replaceAll("_", " ")}
        {t.urgent ? <Badge variant="destructive">urgent</Badge> : null}
        <Badge variant="outline">{t.status}</Badge>
      </h1>
      <Card>
        <CardContent className="grid gap-1 pt-6 text-sm">
          {t.invoice_id ? (
            <p>
              Invoice:{" "}
              <Link className="underline" href={`/invoices/${t.invoice_id}`}>
                <UntrustedText text={t.invoices?.number} />
              </Link>
            </p>
          ) : null}
          <p>
            Customer: <UntrustedText text={t.customers?.display_name} />
          </p>
          {t.reason ? <p>Reason: {t.reason.replaceAll("_", " ")}</p> : null}
          <p>Created {formatInstant(t.created_at, tz)}</p>
          {t.status === "open" && t.blocks_reminders_until ? (
            <p data-testid="blocks-until">Reminders for this invoice are paused until {formatInstant(t.blocks_reminders_until, tz)}.</p>
          ) : null}
          {facts(t.details).map(([k, v]) => (
            <p key={k}>
              {k}: <UntrustedText text={v} />
            </p>
          ))}
          {t.resolved_at ? (
            <p>
              Resolved {formatInstant(t.resolved_at, tz)}: <UntrustedText text={t.resolution_note} />
            </p>
          ) : null}
        </CardContent>
      </Card>
      {summary ? <AiText text={summary} /> : null}
      {t.draft_reply ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Suggested reply (copy it into your own email; nothing is sent from here)</CardTitle>
          </CardHeader>
          <CardContent>
            <CopyDraft text={t.draft_reply} />
          </CardContent>
        </Card>
      ) : null}
      {can(ctx.role, "tasks.resolve") ? <TaskForm taskId={t.id} open={t.status === "open"} /> : null}
    </div>
  );
}
