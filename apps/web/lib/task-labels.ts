// Task types as UI copy (§4.5 S12). Types come from the database CHECK list; unknown ones read as words.
import type { Tone } from "@/components/ui/status-chip";

const TASK: Record<string, { label: string; tone: Tone }> = {
  review_promise: { label: "Review promise", tone: "info" },
  verify_payment_claim: { label: "Payment claim", tone: "warning" },
  dispute: { label: "Dispute", tone: "error" },
  info_request: { label: "Question", tone: "neutral" },
  human_review: { label: "Unclear reply", tone: "neutral" },
  ambiguous_invoice: { label: "Which invoice?", tone: "neutral" },
  unmatched_inbound: { label: "Unknown sender", tone: "neutral" },
  unprocessed_inbound: { label: "Reply not processed", tone: "warning" },
  delivery_failed: { label: "Delivery failed", tone: "warning" },
  invalid_contact: { label: "Contact details", tone: "warning" },
  overpayment_credit: { label: "Overpayment", tone: "info" },
  payment_on_final_invoice: { label: "Payment on closed invoice", tone: "warning" },
  payment_reversal: { label: "Refund or chargeback", tone: "error" },
  unmatched_payment: { label: "Unmatched payment", tone: "warning" },
  payment_amount_mismatch: { label: "Amount mismatch", tone: "warning" },
  unprocessed_payment_event: { label: "Payment event not processed", tone: "warning" },
  review_proof: { label: "Review proof", tone: "info" },
  proof_limit_reached: { label: "Proof limit reached", tone: "neutral" },
};

export function taskVisual(type: string): { label: string; tone: Tone } {
  return TASK[type] ?? { label: type.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()), tone: "neutral" };
}
