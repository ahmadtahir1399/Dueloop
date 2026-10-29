// Parked reasons another screen owns: Unknown sends (rule 17: a human reconciles the message; send_ambiguous is
// the same case before the sweep marks the message unknown) and Approvals. The invoice page never offers
// "Resume reminders" for them; lib/trusted/ops.ts refuses them too.
export const NOT_RESUMABLE: ReadonlySet<string> = new Set(["message_unknown", "send_ambiguous", "awaiting_approval"]);
