import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { PageHeader } from "@/components/ui/page-header";
import { Chip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/lib/session";
import { taskVisual } from "@/lib/task-labels";
import { formatInstant } from "@/lib/time";
import { cn } from "cn";

/** S12 Tasks: urgent (refunds, chargebacks) first, then oldest first. */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const ctx = await requirePermission("tasks.view");
  const sp = await searchParams;
  const status = sp.status === "resolved" ? "resolved" : "open";
  const { data, error } = await ctx.supabase
    .from("tasks")
    .select("id, type, status, urgent, created_at, blocks_reminders_until, invoice_id, invoices(number), customers(display_name)")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", status)
    .order("urgent", { ascending: false })
    .order("created_at")
    .limit(200);
  if (error) throw new Error("could not load tasks");
  const rows = data ?? [];
  const tz = ctx.tenant.timezone;
  const tab = (key: "open" | "resolved", label: string, href: string) => (
    <Link
      href={href}
      aria-current={status === key ? "page" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center border-b-2 px-3 t-body-sm font-medium",
        status === key ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink",
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="grid gap-6">
      <PageHeader title="Tasks" description="Replies, claims and disputes that need a person. Urgent ones come first." />
      <nav aria-label="Task status" className="flex gap-1 border-b border-line">
        {tab("open", "Open", "/tasks")}
        {tab("resolved", "Resolved", "/tasks?status=resolved")}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title={status === "open" ? "No open tasks" : "No resolved tasks"} icon={ClipboardList}>
          {status === "open" ? "Unclear replies and payment claims will appear here." : null}
        </EmptyState>
      ) : (
        <Table data-testid="task-table">
          <caption className="sr-only">Tasks</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Task</TableHead>
              <TableHead scope="col">Invoice</TableHead>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col">Created</TableHead>
              <TableHead scope="col">Reminders</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => {
              const v = taskVisual(t.type);
              return (
                <TableRow key={t.id} data-task={t.type}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Chip tone={v.tone} size="sm">
                        {v.label}
                      </Chip>
                      <Link className="font-semibold text-link underline" href={`/tasks/${t.id}`}>
                        Open<span className="sr-only"> task: {v.label}</span>
                      </Link>
                      {t.urgent ? (
                        <Chip tone="error" size="sm">
                          urgent
                        </Chip>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{t.invoices?.number ? <UntrustedText text={t.invoices.number} /> : "—"}</TableCell>
                  <TableCell className="max-w-56 truncate">
                    <UntrustedText text={t.customers?.display_name} />
                  </TableCell>
                  <TableCell className="tabular-nums">{formatInstant(t.created_at, tz)}</TableCell>
                  <TableCell className="text-ink-muted">{t.status === "open" && t.blocks_reminders_until ? `paused until ${formatInstant(t.blocks_reminders_until, tz)}` : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
