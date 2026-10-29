// Parked reasons another screen owns: Unknown sends (rule 17: a human reconciles the message) and Approvals.
// The invoice page never offers "Resume reminders" for them; lib/trusted/ops.ts refuses them too.
export const NOT_RESUMABLE: ReadonlySet<string> = new Set(["message_unknown", "awaiting_approval"]);
