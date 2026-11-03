import { notFound } from "next/navigation";
import { PaymentPlanForm } from "@/components/payment-plan-form";
import { UntrustedText } from "@/components/untrusted-text";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { tenantToday } from "@/lib/time";
import { paymentAction } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** S15 Record payment: a focused panel (kept as a page because of the Preview → Confirm step, CONFLICTS C-18). */
export default async function NewPaymentPage({ searchParams }: PageProps<"/payments/new">) {
  const ctx = await requirePermission("payments.record");
  const sp = await searchParams;
  const invoiceId = typeof sp.invoice === "string" && UUID.test(sp.invoice) ? sp.invoice : null;
  if (!invoiceId) notFound();
  const { data: inv } = await ctx.supabase
    .from("invoice_list")
    .select("id, number, currency, balance::text, status, customer_name")
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) notFound();
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <div className="grid gap-2">
        <BackLink href={`/invoices/${inv.id}`}>
          <UntrustedText text={inv.number} />
        </BackLink>
        <PageHeader title="Record a payment">
          <p className="flex flex-wrap items-center gap-2 t-body-md text-ink-muted">
            <UntrustedText text={inv.customer_name} /> · balance <span className="font-semibold text-ink tabular-nums">{formatMinor(inv.balance, inv.currency)}</span>
            <StatusChip status={inv.status} size="sm" />
          </p>
        </PageHeader>
      </div>
      <PaymentPlanForm action={paymentAction} hidden={{ invoice: inv.id }} todayHint={tenantToday(ctx.tenant.timezone, new Date())} currency={inv.currency ?? ctx.tenant.currency} />
    </div>
  );
}
