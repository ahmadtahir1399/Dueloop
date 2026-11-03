// Parked reasons another screen owns: Unknown sends (rule 17: a human reconciles the message; send_ambiguous is
// the same case before the sweep marks the message unknown) and Approvals. The invoice page never offers
// "Resume reminders" for them; lib/trusted/ops.ts refuses them too.
export const NOT_RESUMABLE: ReadonlySet<string> = new Set(["message_unknown", "send_ambiguous", "awaiting_approval"]);

/** Plain-language reasons for the pause banner on S07 (C3). Unknown reasons fall back to a neutral sentence. */
const PARKED_TEXT: Record<string, string> = {
  message_unknown: "The result of the last send is unknown. A person must check with the provider.",
  send_ambiguous: "The last send may or may not have gone out. A person must check it.",
  awaiting_approval: "A reminder is waiting for approval.",
  dead_letter: "A send failed repeatedly and was set aside.",
  template_missing: "The reminder's template is missing.",
  template_render_failed: "The reminder's template could not be filled in.",
  policy_missing: "No reminder policy applies to this invoice.",
  policy_invalid: "The reminder policy has a problem.",
  channel_unsupported: "The reminder's channel is not available.",
  no_adapter: "No sending account is set up for this channel.",
};

export function parkedText(reason: string): string {
  return PARKED_TEXT[reason] ?? "Reminders for this invoice are on hold.";
}
