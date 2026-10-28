import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listThreads } from "@/lib/data/inbox";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const ctx = await requirePermission("inbox.view");
  const sp = await searchParams;
  const before = typeof sp.before === "string" ? sp.before : undefined;
  const { rows, next } = await listThreads(ctx, before);
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Inbox</h1>
      <p className="text-sm text-muted-foreground">
        Replies from customers, grouped by customer and channel. Nothing here sends a message.
      </p>
      {rows.length === 0 ? (
        <EmptyState title="No replies yet" />
      ) : (
        <Table data-testid="inbox-table">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col">Channel</TableHead>
              <TableHead scope="col">Messages</TableHead>
              <TableHead scope="col">Last reply</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.customer_id ?? "none"}-${r.channel}`}>
                <TableCell>
                  {r.customer_id ? (
                    <Link className="underline-offset-4 hover:underline" href={`/inbox/${r.customer_id}/${r.channel}`}>
                      <UntrustedText text={r.customer_name} />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Unknown sender (see Tasks)</span>
                  )}
                </TableCell>
                <TableCell>{r.channel}</TableCell>
                <TableCell>
                  {r.messages}
                  {r.unprocessed ? ` (${r.unprocessed} being processed)` : ""}
                </TableCell>
                <TableCell>{formatInstant(r.last_at, ctx.tenant.timezone)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {next ? (
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link href={`/inbox?before=${encodeURIComponent(next)}`}>Older</Link>
        </Button>
      ) : null}
    </div>
  );
}
