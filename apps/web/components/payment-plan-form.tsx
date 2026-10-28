"use client";

// Human-entered payment (manual or from a proof): amount, date and bank reference are typed by the person, never
// pre-filled. "Preview" shows the plan computed by the prompt 5 pipeline; "Confirm" re-plans on the server and
// records only if the numbers are unchanged (the fingerprint). Amounts are shown from minor-unit TEXT.
import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMinor } from "@/lib/money";

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
}: {
  action: (prev: PlanFormState, form: FormData) => Promise<PlanFormState>;
  hidden: Record<string, string>;
  allowNoBankRef?: boolean;
  todayHint: string;
}) {
  const [state, run, pending] = useActionState<PlanFormState, FormData>(action, {});
  // Controlled fields: React resets uncontrolled fields after a form action, and Confirm must resend what was previewed.
  const [v, setV] = useState({ amount: "", decimal: ".", date: "", bank_ref: "", no_bank_ref: false, note: "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setV((o) => ({ ...o, [k]: e.target.type === "checkbox" ? Boolean(e.target.checked) : e.target.value }));
  const p = state.plan;
  return (
    <form action={run} className="grid gap-3 rounded-lg border p-4" aria-describedby="payment-help">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <p id="payment-help" className="text-sm text-muted-foreground">
        Type the amount, date and bank reference exactly as they appear on your bank statement.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor="amount" className="text-sm">
            Amount received
          </label>
          <Input id="amount" name="amount" required inputMode="decimal" autoComplete="off" maxLength={40} aria-describedby="amount-help" value={v.amount} onChange={set("amount")} />
          <p id="amount-help" className="text-xs text-muted-foreground">
            In the invoice currency, e.g. 1250.50
          </p>
        </div>
        <div className="grid gap-1">
          <label htmlFor="decimal" className="text-sm">
            Decimal separator
          </label>
          <select id="decimal" name="decimal" value={v.decimal} onChange={set("decimal")} className="h-9 rounded-md border bg-background px-2">
            <option value=".">. (1250.50)</option>
            <option value=",">, (1250,50)</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="date" className="text-sm">
            Date the money arrived
          </label>
          <Input id="date" name="date" type="date" required max={todayHint} value={v.date} onChange={set("date")} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="bank_ref" className="text-sm">
            Bank reference
          </label>
          <Input id="bank_ref" name="bank_ref" maxLength={120} autoComplete="off" value={v.bank_ref} onChange={set("bank_ref")} />
          {allowNoBankRef ? (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="no_bank_ref" value="1" checked={v.no_bank_ref} onChange={set("no_bank_ref")} /> The statement shows no reference
            </label>
          ) : null}
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <label htmlFor="note" className="text-sm">
            Note (optional)
          </label>
          <Input id="note" name="note" maxLength={500} value={v.note} onChange={set("note")} />
        </div>
      </div>
      {p ? (
        <div className="grid gap-1 rounded-md bg-muted/40 p-3 text-sm" data-testid="payment-plan" role="status">
          <p className="font-medium">Plan for invoice {p.invoiceNumber}</p>
          <p>Balance now: {formatMinor(p.balance, p.currency)}</p>
          <p>Amount: {formatMinor(p.amount, p.currency)}</p>
          <p>Applied to the invoice: {formatMinor(p.applied, p.currency)}</p>
          {p.credit !== "0" ? <p>Kept as credit: {formatMinor(p.credit, p.currency)}</p> : null}
          <p>Status after: {p.transition ?? "unchanged"}</p>
          {p.promise ? <p>Promise: {p.promise}</p> : null}
          <p>{p.receipt ? "A receipt will be emailed to the customer." : "No receipt will be sent."}</p>
          {p.warnings.map((w) => (
            <p key={w} className="text-destructive">
              {w}
            </p>
          ))}
          <input type="hidden" name="fingerprint" value={p.fingerprint} />
        </div>
      ) : null}
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.message ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="op" value="preview" variant="outline" disabled={pending}>
          Preview
        </Button>
        {p ? (
          <Button type="submit" name="op" value="confirm" disabled={pending}>
            Confirm and record
          </Button>
        ) : null}
      </div>
    </form>
  );
}
