import Link from "next/link";
import { notFound } from "next/navigation";
import { AiText, UntrustedText } from "@/components/untrusted-text";
import { loadThread } from "@/lib/data/inbox";
import { requirePermission } from "@/lib/session";
import { formatInstant } from "@/lib/time";

export default async function ThreadPage({ params }: PageProps<"/inbox/[customer]/[channel]">) {
  const ctx = await requirePermission("inbox.view");
  const { customer, channel } = await params;
  const d = await loadThread(ctx, customer, channel);
  if (!d) notFound();
  const tz = ctx.tenant.timezone;
  const summary = (a: unknown): string | null =>
    a && typeof a === "object" && "summary" in a && typeof (a as { summary: unknown }).summary === "string" ? (a as { summary: string }).summary : null;
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">
        <UntrustedText text={d.customer.display_name} /> · {channel}
      </h1>
      <ol className="grid gap-4">
        {d.messages.map((m) => (
          <li key={m.id} className={`grid gap-1 rounded-lg border p-3 ${m.direction === "in" ? "" : "bg-muted/40"}`} data-message={m.id}>
            <p className="text-xs text-muted-foreground">
              {m.direction === "in" ? "Customer" : "Sent by us"} · {formatInstant(m.received_at ?? m.sent_at ?? m.created_at, tz)}
              {m.direction === "in" && m.matched_by ? ` · matched by ${m.matched_by}` : ""}
            </p>
            {m.subject ? (
              <p className="font-medium">
                <UntrustedText text={m.subject} />
              </p>
            ) : null}
            <UntrustedText text={m.body} />
            {m.files.length ? (
              <ul className="text-xs text-muted-foreground">
                {m.files.map((f, i) => (
                  <li key={i}>
                    Attachment: <UntrustedText text={f.name} /> ({f.mime}
                    {f.size !== null ? `, ${f.size} bytes` : ""})
                  </li>
                ))}
              </ul>
            ) : null}
            {m.invoices.length ? (
              <p className="text-xs">
                Matched invoices:{" "}
                {m.invoices.map((i) => (
                  <Link key={i.id} className="mr-2 underline" href={`/invoices/${i.id}`}>
                    <UntrustedText text={i.number} />
                  </Link>
                ))}
              </p>
            ) : null}
            {m.direction === "in" && summary(m.analysis) ? <AiText text={summary(m.analysis)} /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
