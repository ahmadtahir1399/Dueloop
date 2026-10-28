import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";

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
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <nav aria-label="Task status" className="flex gap-2 text-sm">
          <Link href="/tasks" aria-current={status === "open" ? "page" : undefined} className={status === "open" ? "font-semibold" : "underline"}>
            Open
          </Link>
          <Link href="/tasks?status=resolved" aria-current={status === "resolved" ? "page" : undefined} className={status === "resolved" ? "font-semibold" : "underline"}>
            Resolved
          </Link>
        </nav>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={status === "open" ? "No open tasks" : "No resolved tasks"} />
      ) : (
        <Table data-testid="task-table">
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
            {rows.map((t) => (
              <TableRow key={t.id} data-task={t.type}>
                <TableCell>
                  <Link className="underline" href={`/tasks/${t.id}`}>
                    {t.type.replaceAll("_", " ")}
                  </Link>
                  {t.urgent ? (
                    <Badge variant="destructive" className="ml-2">
                      urgent
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{t.invoices?.number ? <UntrustedText text={t.invoices.number} /> : "—"}</TableCell>
                <TableCell>
                  <UntrustedText text={t.customers?.display_name} />
                </TableCell>
                <TableCell>{formatInstant(t.created_at, tz)}</TableCell>
                <TableCell>{t.status === "open" && t.blocks_reminders_until ? `paused until ${formatInstant(t.blocks_reminders_until, tz)}` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
