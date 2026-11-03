import Link from "next/link";
import { notFound } from "next/navigation";
import { AiText, UntrustedText } from "@/components/untrusted-text";
import { aiSummaryOf } from "@/lib/ai-summary";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page-header";
import { loadThread } from "@/lib/data/inbox";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";
import { cn } from "cn";

const CHANNEL_LABEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", sms: "SMS", web: "Pay page" };

/** S10 thread: message bubbles, plain text only (rule 34). */
export default async function ThreadPage({ params }: PageProps<"/inbox/[customer]/[channel]">) {
  const ctx = await requirePermission("inbox.view");
  const { customer, channel } = await params;
  const d = await loadThread(ctx, customer, channel);
  if (!d) notFound();
  const tz = ctx.tenant.timezone;
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/inbox">Inbox</BackLink>
        <PageHeader
          title={
            <>
              <UntrustedText text={d.customer.display_name} /> <span className="text-ink-muted">· {CHANNEL_LABEL[channel] ?? channel}</span>
            </>
          }
        />
      </div>
      <ol className="mx-auto grid w-full max-w-3xl gap-4">
        {d.messages.map((m) => (
          <li
            key={m.id}
            data-message={m.id}
            className={cn("grid max-w-[85%] gap-1 rounded-lg p-4 t-body-sm", m.direction === "in" ? "justify-self-start bg-panel border border-line" : "justify-self-end bg-brand-soft")}
          >
            <p className="t-caption text-ink-muted">
              {m.direction === "in" ? "Customer" : "Sent by us"} · {formatInstant(m.received_at ?? m.sent_at ?? m.created_at, tz)}
              {m.direction === "in" && m.matched_by ? ` · matched by ${m.matched_by}` : ""}
            </p>
            {m.subject ? (
              <p className="font-semibold">
                <UntrustedText text={m.subject} />
              </p>
            ) : null}
            <UntrustedText text={m.body} />
            {m.files.length ? (
              <ul className="t-caption text-ink-muted">
                {m.files.map((f, i) => (
                  <li key={i}>
                    Attachment: <UntrustedText text={f.name} /> ({f.mime}
                    {f.size !== null ? `, ${f.size} bytes` : ""})
                  </li>
                ))}
              </ul>
            ) : null}
            {m.invoices.length ? (
              <p className="t-caption">
                Matched invoices:{" "}
                {m.invoices.map((i) => (
                  <Link key={i.id} className="mr-2 font-medium text-link underline" href={`/invoices/${i.id}`}>
                    <UntrustedText text={i.number} />
                  </Link>
                ))}
              </p>
            ) : null}
            {m.direction === "in" && aiSummaryOf(m.analysis) ? <AiText text={aiSummaryOf(m.analysis)} /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
