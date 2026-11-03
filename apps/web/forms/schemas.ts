// Client-side form schemas (redesign §5.3–§5.6). Each key is the EXACT FormData name the existing server action
// reads, so a valid form posts the same body as before (D10). The server action stays the authority: these only
// catch mistakes early with the §5.6 wording. Rules mirror the actions (same minimums and maximums).
import { isIanaZone, parseMajor } from "@dueloop/core";
import { z } from "zod";
import { IsoDate, LiveChannel } from "../domain/invoice.ts";
import { amountExample } from "../domain/money.ts";

const tooLong = (n: number) => `Keep this under ${n} characters.`;
const email = z.string().trim().min(1, { error: "Enter your email address." }).pipe(z.email({ error: "Enter an email address like name@example.com." }));

// ---- F01 / F02 auth (server: login/actions.ts, password >= 8) ----
export const PASSWORD_MIN = 8;
export const signInSchema = z.object({
  email,
  password: z.string().min(1, { error: "Enter your password." }),
});
export const signUpSchema = z
  .object({
    email,
    password: z.string().min(PASSWORD_MIN, { error: `Use at least ${PASSWORD_MIN} characters.` }),
    confirmPassword: z.string().min(1, { error: "Enter the password again." }),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], error: "The passwords don't match." });

// ---- F04 onboarding (server: onboarding/actions.ts) ----
const hour = z.string().regex(/^([01]?\d|2[0-3])$/, { error: "Choose an hour." });
export const onboardingSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter business name." }).max(200, { error: tooLong(200) }),
  timezone: z.string().refine(isIanaZone, { error: "Choose a time zone from the list." }),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, { error: "Use a 3-letter currency code, like PKR." }),
  quietStart: hour,
  quietEnd: hour,
});

// ---- F07 / F09 record a payment (server: lib/trusted/ops → payments planManualPayment, ingest parseAmount) ----
export function paymentSchema(ctx: { currency: string; today: string; allowNoBankRef?: boolean }) {
  return z
    .object({
      amount: z.string().trim().min(1, { error: "Enter the amount you received." }),
      decimal: z.enum([".", ","]),
      date: IsoDate.refine((d) => d <= ctx.today, { error: "The payment date can't be in the future." }),
      bank_ref: z.string().trim().max(120, { error: tooLong(120) }),
      no_bank_ref: z.union([z.literal("1"), z.literal(false), z.literal(true), z.undefined()]).optional(),
      note: z.string().trim().max(500, { error: tooLong(500) }).optional(),
    })
    .superRefine((v, c) => {
      if (!amountLooksValid(v.amount, v.decimal, ctx.currency)) {
        c.addIssue({ code: "custom", path: ["amount"], message: `Enter an amount like ${amountExample(ctx.currency, v.decimal)}.` });
      }
      const skipped = ctx.allowNoBankRef && (v.no_bank_ref === "1" || v.no_bank_ref === true);
      if (!skipped && v.bank_ref === "") c.addIssue({ code: "custom", path: ["bank_ref"], message: "Enter the bank reference so this payment can be traced." });
    });
}

/**
 * A first check only (the server's ingest parseAmount is the authority and also accepts currency codes and
 * symbols). Group separators and spaces are dropped, the decimal mark becomes ".", then core's parseMajor checks
 * the digits against the currency's exponent. Zero is refused, like the server.
 */
export function amountLooksValid(text: string, decimal: "." | ",", currency: string): boolean {
  const group = decimal === "." ? "," : ".";
  const plain = text.trim().replace(/[\s']/g, "").split(group).join("").replace(decimal, ".");
  const m = parseMajor(plain, currency);
  return m.ok && m.value.minor > 0;
}

// ---- F06 reject approval (server: approvals/actions.ts requires >= 3 characters, CONFLICTS C-12) ----
export const rejectApprovalSchema = z.object({
  note: z.string().trim().min(3, { error: "Say why you are rejecting it (at least 3 characters)." }).max(500, { error: tooLong(500) }),
});
export const editApprovalSchema = z.object({
  subject: z.string().max(200, { error: tooLong(200) }).optional(),
  body: z.string().trim().min(1, { error: "Enter the message." }).max(5000, { error: tooLong(5000) }),
});
export const bulkApproveSchema = z
  .object({
    approval: z.union([z.array(z.string()), z.string(), z.literal(false)]).optional(),
    confirm_count: z.string().trim().regex(/^\d+$/, { error: "Type how many you selected." }),
  })
  .superRefine((v, c) => {
    const n = Array.isArray(v.approval) ? v.approval.length : typeof v.approval === "string" ? 1 : 0;
    if (n === 0) c.addIssue({ code: "custom", path: ["approval"], message: "Select at least one approval." });
    else if (Number(v.confirm_count) !== n) c.addIssue({ code: "custom", path: ["confirm_count"], message: `You selected ${n}. Type ${n} to confirm.` });
  });

// ---- F08 resolve / reopen task, F22 cancel promise (server: >= 3 characters) ----
export const noteRequiredSchema = z.object({
  note: z.string().trim().min(3, { error: "Write a short reason (at least 3 characters)." }).max(500, { error: tooLong(500) }),
});

// ---- F10 unknown send (server: messages/actions.ts) ----
export const reconcileSchema = z.object({
  checked: z.union([z.literal("1"), z.literal(true)], { error: "Confirm that you checked with the provider first." }),
});

// ---- F11 consent (server: customers/[id]/actions.ts) ----
export const consentSchema = z.object({
  channel: LiveChannel,
  source: z
    .string()
    .trim()
    .min(3, { error: "Say how the customer agreed (for example: signed order form, 2 March)." })
    .max(200, { error: tooLong(200) }),
});

// ---- F13 settings (server: settings/admin-actions.ts + core validateSettings) ----
export const settingsSchema = z.object({
  timezone: z.string().trim().refine(isIanaZone, { error: "Choose a time zone like Europe/London." }),
  quiet_start: hour,
  quiet_end: hour,
  approval_mode: z.enum(["always", "low_confidence", "never"]),
  promise_acceptance: z.enum(["auto", "review"]),
  budget: z.string().trim().regex(/^\d{1,12}$/, { error: "Enter a whole number of minor units (0 blocks WhatsApp and SMS)." }),
  bank_instructions: z.string().max(1000, { error: tooLong(1000) }).optional(),
  proof_ai_extraction: z.union([z.boolean(), z.literal("on")]).optional(),
});

// ---- F14c holiday ----
export const holidaySchema = z.object({
  date: IsoDate,
  label: z.string().trim().max(80, { error: tooLong(80) }).optional(),
});

// ---- F15 invite member ----
export const inviteSchema = z.object({
  email,
  role: z.enum(["owner", "accountant", "collector"], { error: "Choose a role." }),
});

// ---- F17 create API key ----
export const apiKeySchema = z.object({
  name: z.string().trim().min(1, { error: "Enter key name." }).max(80, { error: tooLong(80) }),
});

// ---- F18 kill switch (server: settings/actions.ts types PAUSE / RESUME, CONFLICTS C-20) ----
export function killSwitchSchema(word: "PAUSE" | "RESUME") {
  return z.object({
    confirm: z
      .string()
      .trim()
      .refine((v) => v.toUpperCase() === word, { error: `Type ${word} exactly to confirm.` }),
  });
}

// ---- F14b template (server: settings/templates/actions.ts) ----
export const templateSchema = z.object({
  subject: z.string().max(200, { error: tooLong(200) }).optional(),
  body: z.string().trim().min(1, { error: "Enter the message." }).max(5000, { error: tooLong(5000) }),
});
