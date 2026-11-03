import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, X } from "lucide-react";
import { can } from "@dueloop/authz";
import { ActionForm } from "@/components/action-form";
import { UntrustedText } from "@/components/untrusted-text";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { loadCustomer } from "@/lib/data/customers";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { formatDate, formatInstant } from "@/lib/time";
import { consentAction } from "./actions";
import { ConsentForm } from "./consent-form";

const CHANNEL_LABEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", sms: "SMS" };

/** S09 Customer detail: invoices = money context, consent = what we may send (§4.4). */
export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const ctx = await requirePermission("customers.view");
  const { id } = await params;
  const d = await loadCustomer(ctx, id);
  if (!d) notFound();
  const c = d.customer;
  const tz = ctx.tenant.timezone;
  const mayManage = can(ctx.role, "consents.manage");
  const active = new Set(d.consents.filter((k) => !k.revoked_at).map((k) => k.channel));

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <BackLink href="/customers">Customers</BackLink>
        <PageHeader title={<UntrustedText text={c.display_name} />} description={c.opted_out ? "Opted out: no reminders are sent." : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="inv-h" className="card-edge grid content-start gap-3 rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="inv-h" className="t-label">
              Invoices
            </h2>
            <Link href={`/invoices?customer=${c.id}`} className="t-body-sm font-medium text-link hover:underline">
              All invoices
            </Link>
          </div>
          {d.invoices.length === 0 ? <p className="t-body-sm text-ink-muted">No invoices.</p> : null}
          <ul className="divide-y divide-line">
            {d.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 t-body-sm">
                <Link className="font-semibold text-link underline" href={`/invoices/${i.id}`}>
                  <UntrustedText text={i.number} />
                </Link>
                <StatusChip status={i.status} size="sm" />
                <span className="text-ink-muted">due {formatDate(i.due_on)}</span>
                <span className="ml-auto font-semibold tabular-nums">{formatMinor(i.balance, i.currency)}</span>
              </li>
            ))}
          </ul>
          <Link href="/inbox" className="t-body-sm font-medium text-link hover:underline">
            Conversation in the inbox
          </Link>
        </section>

        <div className="grid content-start gap-4">
          <section aria-labelledby="consent-h" className="card-edge grid gap-3 rounded-xl border border-line bg-panel p-5">
            <h2 id="consent-h" className="t-label">
              Consent
            </h2>
            <ul className="grid gap-2" data-testid="consent-list">
              {(["email", "whatsapp"] as const).map((ch) => (
                <li key={ch} className="flex items-center gap-2 t-body-sm">
                  {active.has(ch) ? (
                    <Check aria-hidden="true" className="size-4 text-success-ink" />
                  ) : (
                    <X aria-hidden="true" className="size-4 text-ink-muted" />
                  )}
                  <span className="font-medium">{CHANNEL_LABEL[ch]}</span>
                  <span className="text-ink-muted">{active.has(ch) ? "consent recorded" : "no consent recorded"}</span>
                </li>
              ))}
            </ul>
            {d.consents.length === 0 ? <p className="t-caption text-ink-muted">No consent recorded. WhatsApp reminders are skipped without one.</p> : null}
            <ul className="grid gap-2">
              {d.consents.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2 t-caption text-ink-muted">
                  <span>
                    {CHANNEL_LABEL[k.channel] ?? k.channel}: granted {formatInstant(k.granted_at, tz)} (<UntrustedText text={k.source} />)
                    {k.revoked_at ? `, revoked ${formatInstant(k.revoked_at, tz)}` : ""}
                  </span>
                  {!k.revoked_at && mayManage ? (
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
            <p data-testid="opt-out-state" className="t-body-sm">
              <span className="font-medium">Opt-out:</span> {c.opted_out ? "Opted out: no reminders are sent. Only an operator can reverse this." : "Not opted out."}
            </p>
            {mayManage ? (
              <div className="grid gap-2 border-t border-line pt-3">
                <h3 className="t-heading-sm">Record consent</h3>
                <ConsentForm customerId={c.id} />
              </div>
            ) : null}
          </section>
          <section aria-labelledby="contact-h" className="card-edge grid gap-2 rounded-xl border border-line bg-panel p-5 t-body-sm">
            <h2 id="contact-h" className="t-label">
              Contact
            </h2>
            <p className="break-all">
              <span className="text-ink-muted">Email </span>
              <UntrustedText text={c.email} />
            </p>
            <p>
              <span className="text-ink-muted">Phone </span>
              <span className="tabular-nums">{c.phone_e164 ?? "—"}</span>
            </p>
            <p>
              <span className="text-ink-muted">Language </span>
              {c.language}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
