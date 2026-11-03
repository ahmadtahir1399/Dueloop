"use client";

import { PaymentPlanForm } from "@/components/payment-plan-form";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormSuccess } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { z } from "zod";
import { useActionForm } from "@/lib/use-action-form";
import { proofDecision, type PlanState } from "../actions";

const rejectProofSchema = z.object({
  reason: z.string().trim().min(3, { error: "Give a short reason (at least 3 characters)." }).max(500, { error: "Keep this under 500 characters." }),
});

/** F09 Proof decision: confirm through the payment form (prefilled only with the currency) or reject with a reason. */
export function ProofDecisionForm({ proofId, currency, today }: { proofId: string; currency: string; today: string }) {
  const reject = useActionForm<PlanState, typeof rejectProofSchema>({ schema: rejectProofSchema, action: proofDecision, initial: {}, defaultValues: { reason: "" }, id: "reject-proof" });
  return (
    <div className="grid content-start gap-4">
      <h2 className="t-heading-md">Confirm the payment</h2>
      <PaymentPlanForm action={proofDecision} hidden={{ proof: proofId }} allowNoBankRef todayHint={today} currency={currency} />
      <form {...reject.formProps} aria-label="Reject proof" className="card-edge grid gap-3 rounded-xl border border-line bg-panel p-5">
        <input type="hidden" name="proof" value={proofId} />
        <input type="hidden" name="op" value="reject" />
        <FormError id={reject.errorId} message={reject.state.error} />
        <Field id="reason" label="Or reject it (reason required)" error={reject.form.formState.errors.reason?.message as string | undefined}>
          {(a) => <Input {...a} maxLength={500} {...reject.form.register("reason")} />}
        </Field>
        <Button type="submit" variant="outline" className="w-fit" loading={reject.pending}>
          Reject proof
        </Button>
        <FormSuccess message={reject.state.message} />
      </form>
    </div>
  );
}
