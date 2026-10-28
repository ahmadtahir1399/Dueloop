"use client";

import { useActionState } from "react";
import { PaymentPlanForm } from "@/components/payment-plan-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { proofDecision, type PlanState } from "../actions";

export function ProofDecisionForm({ proofId }: { proofId: string }) {
  const [rejected, reject, rejecting] = useActionState<PlanState, FormData>(proofDecision, {});
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="grid gap-4">
      <h2 className="font-semibold">Confirm the payment</h2>
      <PaymentPlanForm action={proofDecision} hidden={{ proof: proofId }} allowNoBankRef todayHint={today} />
      <form action={reject} className="grid gap-2 rounded-lg border p-4">
        <input type="hidden" name="proof" value={proofId} />
        <input type="hidden" name="op" value="reject" />
        <label htmlFor="reason" className="text-sm font-medium">
          Or reject it (reason required)
        </label>
        <Input id="reason" name="reason" required minLength={3} maxLength={500} />
        <Button type="submit" variant="outline" className="w-fit" disabled={rejecting}>
          Reject proof
        </Button>
        {rejected.error ? <p role="alert" className="text-sm text-destructive">{rejected.error}</p> : null}
        {rejected.message ? <p role="status" className="text-sm text-success">{rejected.message}</p> : null}
      </form>
    </div>
  );
}
