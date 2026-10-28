import Link from "next/link";
import { notFound } from "next/navigation";
import { PaymentPlanForm } from "@/components/payment-plan-form";
import { UntrustedText } from "@/components/untrusted-text";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { tenantToday } from "@/lib/time";
import { paymentAction } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    <div className="grid max-w-2xl gap-4">
      <h1 className="text-xl font-semibold">Record a payment</h1>
      <p className="text-sm">
        Invoice{" "}
        <Link className="underline" href={`/invoices/${inv.id}`}>
          <UntrustedText text={inv.number} />
        </Link>{" "}
        for <UntrustedText text={inv.customer_name} />: balance {formatMinor(inv.balance, inv.currency)} ({inv.status}).
      </p>
      <PaymentPlanForm action={paymentAction} hidden={{ invoice: inv.id }} todayHint={tenantToday(ctx.tenant.timezone, new Date())} />
    </div>
  );
}
