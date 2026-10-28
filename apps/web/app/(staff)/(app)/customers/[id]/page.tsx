import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { UntrustedText } from "@/components/untrusted-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadCustomer } from "@/lib/data/customers";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { formatDate, formatInstant } from "@/lib/time";

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const ctx = await requirePermission("customers.view");
  const { id } = await params;
  const d = await loadCustomer(ctx, id);
  if (!d) notFound();
  const c = d.customer;
  const tz = ctx.tenant.timezone;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">
        <UntrustedText text={c.display_name} />
      </h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact and consent</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <p>
            Email: <UntrustedText text={c.email} />
          </p>
          <p>Phone: {c.phone_e164 ?? "—"}</p>
          <p>Language: {c.language}</p>
          <p data-testid="opt-out-state">{c.opted_out ? "Opted out: no reminders are sent." : "Not opted out."}</p>
          <ul className="mt-2 grid gap-1">
            {d.consents.map((k) => (
              <li key={k.id}>
                {k.channel}: granted {formatInstant(k.granted_at, tz)} ({k.source})
                {k.revoked_at ? `, revoked ${formatInstant(k.revoked_at, tz)}` : ""}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          {d.invoices.map((i) => (
            <p key={i.id} className="flex flex-wrap items-center gap-2">
              <Link className="underline" href={`/invoices/${i.id}`}>
                <UntrustedText text={i.number} />
              </Link>
              <StatusBadge status={i.status} /> due {formatDate(i.due_on)} · {formatMinor(i.balance, i.currency)}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
