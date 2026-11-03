"use client";

// Human-entered payment (manual or from a proof): amount, date and bank reference are typed by the person, never
// pre-filled (rule 31: extracted text never becomes an amount). "Preview" shows the plan computed by the prompt 5
// pipeline; "Confirm" re-plans on the server and records only if the numbers are unchanged (the fingerprint).
// React Hook Form + Zod checks the fields first (§5.4); the server action is unchanged and stays the authority.
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { RhfSelect } from "@/components/ui/choice-select";
import { DatePicker } from "@/components/ui/date-picker";
import { Checkbox, Field, FormError, MoneyInput } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { amountExample } from "@/domain/money";
import { paymentSchema } from "@/forms/schemas";
import { formatMinor } from "@/lib/money";
import { useActionForm } from "@/lib/use-action-form";

export interface PlanView {
  invoiceNumber: string;
  currency: string;
  balance: string;
  amount: string;
  applied: string;
  credit: string;
  transition: string | null;
  promise: string | null;
  receipt: boolean;
  fingerprint: string;
  warnings: string[];
}
export interface PlanFormState {
  error?: string;
  message?: string;
  plan?: PlanView;
}

export function PaymentPlanForm({
  action,
  hidden,
  allowNoBankRef = false,
  todayHint,
  currency,
}: {
  action: (prev: PlanFormState, form: FormData) => Promise<PlanFormState>;
  hidden: Record<string, string>;
  allowNoBankRef?: boolean;
  todayHint: string;
  /** Invoice currency (prefilled only with the currency, never with an amount: §4.5 S13). */
  currency: string;
}) {
  const schema = paymentSchema({ currency, today: todayHint, allowNoBankRef });
  const { form, state, pending, formProps, errorId } = useActionForm<PlanFormState, typeof schema>({
    schema,
    action,
    initial: {},
    defaultValues: { amount: "", decimal: ".", date: "", bank_ref: "", note: "" },
    id: "payment",
  });
  const e = form.formState.errors;
  const decimal = (form.watch("decimal") as "." | "," | undefined) ?? ".";
  const p = state.plan;
  return (
    <form {...formProps} className="card-edge grid gap-5 rounded-xl border border-line bg-panel p-5" aria-describedby="payment-help">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <p id="payment-help" className="t-body-sm text-ink-muted">
        Type the amount, date and bank reference exactly as they appear on your bank statement.
      </p>
      <FormError id={errorId} message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="amount" label="Amount received" help={`In ${currency}, e.g. ${amountExample(currency, decimal)}`} error={e.amount?.message as string | undefined}>
          {(a) => <MoneyInput {...a} currency={currency} maxLength={40} {...form.register("amount")} />}
        </Field>
        <Field id="decimal" label="Decimal separator">
          {(a) => (
            <RhfSelect control={form.control} name="decimal" field={a} options={[{ value: ".", label: ". (1250.50)" }, { value: ",", label: ", (1250,50)" }]} />
          )}
        </Field>
        <Field id="date" label="Date the money arrived" error={e.date?.message as string | undefined}>
          {(a) => <DatePicker {...a} {...form.register("date")} max={todayHint} />}
        </Field>
        <Field id="bank_ref" label="Bank reference" help="Shown on the receipt." error={e.bank_ref?.message as string | undefined}>
          {(a) => (
            <div className="grid gap-1">
              <Input {...a} maxLength={120} autoComplete="off" {...form.register("bank_ref")} />
              {allowNoBankRef ? <Checkbox value="1" label="The statement shows no reference" {...form.register("no_bank_ref")} /> : null}
            </div>
          )}
        </Field>
        <Field id="note" label="Note (optional)" className="sm:col-span-2" error={e.note?.message as string | undefined}>
          {(a) => <Input {...a} maxLength={500} {...form.register("note")} />}
        </Field>
      </div>
      {p ? (
        <div className="grid gap-3 rounded-lg border border-line bg-sunken p-4 t-body-sm" data-testid="payment-plan" role="status">
          <p className="t-heading-sm">Plan for invoice {p.invoiceNumber}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <dt className="text-ink-muted">Balance now</dt>
            <dd className="text-right tabular-nums">{formatMinor(p.balance, p.currency)}</dd>
            <dt className="text-ink-muted">Amount</dt>
            <dd className="text-right tabular-nums">{formatMinor(p.amount, p.currency)}</dd>
            <dt className="text-ink-muted">Applied to the invoice</dt>
            <dd className="text-right font-semibold tabular-nums">{formatMinor(p.applied, p.currency)}</dd>
            {p.credit !== "0" ? (
              <>
                <dt className="text-ink-muted">Kept as credit</dt>
                <dd className="text-right tabular-nums">{formatMinor(p.credit, p.currency)}</dd>
              </>
            ) : null}
          </dl>
          {p.credit !== "0" ? <Banner tone="info">{formatMinor(p.credit, p.currency)} more than the balance will be recorded as credit.</Banner> : null}
          <p>Status after: {p.transition ?? "unchanged"}</p>
          {p.promise ? <p>Promise: {p.promise}</p> : null}
          <p>{p.receipt ? "A receipt will be emailed to the customer." : "No receipt will be sent."}</p>
          {p.warnings.map((w) => (
            <p key={w} className="text-error-ink">
              {w}
            </p>
          ))}
          <input type="hidden" name="fingerprint" value={p.fingerprint} />
        </div>
      ) : null}
      {state.message ? <Banner tone="success" role="status">{state.message}</Banner> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="op" value="preview" variant={p ? "outline" : "default"} disabled={pending}>
          Preview
        </Button>
        {p ? (
          <Button type="submit" name="op" value="confirm" loading={pending} loadingLabel="Recording…">
            Confirm and record
          </Button>
        ) : null}
      </div>
    </form>
  );
}
