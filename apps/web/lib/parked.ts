// Parked reasons another screen owns: Unknown sends (rule 17: a human reconciles the message; send_ambiguous is
// the same case before the sweep marks the message unknown) and Approvals. The invoice page never offers
// "Resume reminders" for them; lib/trusted/ops.ts refuses them too.
export const NOT_RESUMABLE: ReadonlySet<string> = new Set(["message_unknown", "send_ambiguous", "awaiting_approval"]);

/**
 * Plain-language reasons for the pause banner on S07 (C3). Unknown reasons fall back to a neutral sentence.
 * Sources of the reasons: packages/messaging/src/router.ts (NoRouteReason that park, not skip),
 * packages/worker/src/process.ts (park() and setNextAction) and packages/worker/src/context.ts (loadContext).
 */
const PARKED_TEXT: Record<string, string> = {
  message_unknown: "The result of the last send is unknown. A person must check with the provider.",
  send_ambiguous: "The last send may or may not have gone out. A person must check it.",
  awaiting_approval: "A reminder is waiting for approval.",
  dead_letter: "A send failed repeatedly and was set aside.",
  account_missing: "No sending account is ready for this channel. For email, set the sender address in Settings, Integrations.",
  budget_exhausted: "This month's WhatsApp and SMS budget is used up. Raise it in Settings, General.",
  template_missing: "The reminder's template is missing.",
  template_unapproved: "The WhatsApp template is not approved yet. An owner marks it approved in Settings, Templates.",
  template_render_failed: "The reminder's template could not be filled in.",
  public_link_unavailable: "The customer's pay link could not be created. Try again later.",
  payment_link_unavailable: "The payment link could not be created. Check the payment connection in Settings, Integrations.",
  policy_missing: "No reminder policy applies to this invoice.",
  policy_invalid: "The reminder policy has a problem.",
  settings_invalid: "The business settings have a problem. Check Settings, General.",
  invoice_invalid: "This invoice's data has a problem, so no reminder can be built for it.",
  channel_unsupported: "The reminder's channel is not available.",
  no_adapter: "No sending account is set up for this channel.",
};

/** The settings page that fixes a tenant-side cause; null when the fix is elsewhere or unknown. */
const PARKED_FIX: Record<string, string> = {
  account_missing: "/settings/integrations",
  no_adapter: "/settings/integrations",
  payment_link_unavailable: "/settings/integrations",
  budget_exhausted: "/settings",
  settings_invalid: "/settings",
  template_missing: "/settings/templates",
  template_unapproved: "/settings/templates",
  template_render_failed: "/settings/templates",
  policy_missing: "/settings/policies",
  policy_invalid: "/settings/policies",
};

// Object.hasOwn: the reason comes from the database, so "constructor" or "toString" must not hit the prototype.
const own = (map: Record<string, string>, key: string): string | null => (Object.hasOwn(map, key) ? (map[key] ?? null) : null);

export function parkedText(reason: string): string {
  return own(PARKED_TEXT, reason) ?? "Reminders for this invoice are on hold.";
}

export function parkedFixHref(reason: string): string | null {
  return own(PARKED_FIX, reason);
}

/** The permission the fix page itself requires (the settings pages call requirePermission with these). */
export function parkedFixPermission(href: string): "integrations.view" | "settings.view" {
  return href === "/settings/integrations" ? "integrations.view" : "settings.view";
}
