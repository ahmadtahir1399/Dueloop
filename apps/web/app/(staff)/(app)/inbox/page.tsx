import Link from "next/link";
import { ChevronRight, MessagesSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { UntrustedText } from "@/components/untrusted-text";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Chip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listThreads } from "@/lib/data/inbox";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";

const CHANNEL_LABEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", sms: "SMS", web: "Pay page" };

/** S10 Inbox: read-only (sending happens only through the policy pipeline). */
export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const ctx = await requirePermission("inbox.view");
  const sp = await searchParams;
  const before = typeof sp.before === "string" ? sp.before : undefined;
  const { rows, next } = await listThreads(ctx, before);
  return (
    <div className="grid gap-6">
      <PageHeader title="Inbox" description="Replies from customers, grouped by customer and channel. Nothing here sends a message." />
      <Banner tone="info">Email replies are not read yet. They go to your own inbox.</Banner>
      {rows.length === 0 ? (
        <EmptyState title="No messages yet" icon={MessagesSquare}>
          Sent reminders and replies will appear here.
        </EmptyState>
      ) : (
        <Table data-testid="inbox-table">
          <caption className="sr-only">Conversations</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col">Channel</TableHead>
              <TableHead scope="col" className="text-right">
                Messages
              </TableHead>
              <TableHead scope="col">Last reply</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.customer_id ?? "none"}-${r.channel}`}>
                <TableCell>
                  {r.customer_id ? (
                    <Link className="inline-flex items-center gap-1 font-semibold text-link underline-offset-4 hover:underline" href={`/inbox/${r.customer_id}/${r.channel}`}>
                      <UntrustedText text={r.customer_name} />
                      <ChevronRight aria-hidden="true" className="size-4" />
                    </Link>
                  ) : (
                    <span className="text-ink-muted">Unknown sender (see Tasks)</span>
                  )}
                </TableCell>
                <TableCell>
                  <Chip tone="neutral">{CHANNEL_LABEL[r.channel ?? ""] ?? r.channel}</Chip>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.messages}
                  {r.unprocessed ? <span className="t-caption text-ink-muted"> ({r.unprocessed} being processed)</span> : null}
                </TableCell>
                <TableCell className="tabular-nums">{formatInstant(r.last_at, ctx.tenant.timezone)}</TableCell>
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
