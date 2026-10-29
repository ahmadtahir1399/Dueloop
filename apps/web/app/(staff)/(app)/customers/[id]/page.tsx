import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@dueloop/authz";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UntrustedText } from "@/components/untrusted-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadCustomer } from "@/lib/data/customers";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { formatDate, formatInstant } from "@/lib/time";
import { consentAction } from "./actions";

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
          <ul className="mt-2 grid gap-1" data-testid="consent-list">
            {d.consents.length === 0 ? <li className="text-muted-foreground">No consent recorded. WhatsApp reminders are skipped without one.</li> : null}
            {d.consents.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {k.channel}: granted {formatInstant(k.granted_at, tz)} ({k.source})
                  {k.revoked_at ? `, revoked ${formatInstant(k.revoked_at, tz)}` : ""}
                </span>
                {!k.revoked_at && can(ctx.role, "consents.manage") ? (
                  <ActionForm action={consentAction} label={`Withdraw ${k.channel} consent`} className="inline-flex items-center gap-2">
                    <input type="hidden" name="op" value="withdraw" />
                    <input type="hidden" name="customer" value={c.id} />
                    <input type="hidden" name="channel" value={k.channel} />
                    <Button type="submit" size="sm" variant="outline">
                      Withdraw
                    </Button>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
          {can(ctx.role, "consents.manage") ? (
            <ActionForm action={consentAction} label="Record consent" className="mt-3 grid max-w-md gap-2">
              <input type="hidden" name="op" value="grant" />
              <input type="hidden" name="customer" value={c.id} />
              <label className="grid gap-1">
                Channel
                <select name="channel" className="h-9 rounded-md border bg-background px-2" defaultValue="whatsapp">
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                </select>
              </label>
              <label className="grid gap-1">
                How did they agree? (kept as evidence)
                <Input name="source" maxLength={200} autoComplete="off" />
              </label>
              <Button type="submit" className="w-fit">
                Record consent
              </Button>
            </ActionForm>
          ) : null}
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
