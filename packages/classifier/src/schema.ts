// The ONLY shape model output may take (rule 21). Strict: unknown keys, wrong types and oversized strings are
// rejected, never coerced. Amounts are text (code parses them, issue C2); dates are validated later (rule 26).
import { REPLY_INTENTS } from '@dueloop/core';
import { z } from 'zod';

export const MAX_SUMMARY = 280;

export const ReplyAnalysis = z.strictObject({
  intent: z.enum(REPLY_INTENTS),
  confidence: z.number().min(0).max(1),
  /** 'YYYY-MM-DD' in the tenant's timezone, resolved against the reference date given in the prompt. */
  promisedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** The customer's own words for the date ("the 15th", "end of the month"). */
  promisedDateText: z.string().max(100).nullable(),
  /** True for vague dates: "soon", "end of the month", "in a couple of days". */
  dateIsVague: z.boolean(),
  /** The amount as written ("£500", "half"), or null. Never a number from the model. */
  statedAmountText: z.string().max(50).nullable(),
  /** Detected language code, e.g. 'en', 'de', 'ur', or 'mixed'. */
  language: z.string().min(2).max(12),
  /** Attacker-controlled text: never logged, never sent, shown only as untrusted (issue C6). */
  summary: z.string().max(MAX_SUMMARY),
});
export type ReplyAnalysis = z.infer<typeof ReplyAnalysis>;

/** JSON Schema of ReplyAnalysis for providers with structured output. */
export const replyAnalysisJsonSchema = () => z.toJSONSchema(ReplyAnalysis);
