# 0029: Classifier boundary, prompt, thresholds and evaluation

**Boundary.** `ReplyClassifier.classify(input)` returns the model's raw output. The strict zod
`ReplyAnalysis` (unknown keys rejected, amounts as text, dates as `YYYY-MM-DD` or null) and `toProposal`
turn it into a core `Proposal` or a typed review reason. One retry on invalid output, then human_review. An
outage is retried through the event queue, then dead-lettered with a task. Rule 21: customer text is data,
and the only thing model output can become is a Proposal.

**Input.** The model sees only the customer's new text and nothing else that identifies anyone:
- The text is redacted: emails, phone/account numbers, the customer's and business's names and the
  customer's invoice numbers are replaced. Dates and amounts are kept.
- Invisible and bidi characters are stripped, and the text is truncated at 2000 characters.
- It also gets the reference local date, weekday and zone (when the customer wrote, issue K), the currency
  and a locale hint.

**Prompt.** `packages/classifier/prompts/reply-v1.md` is data, versioned. The message sits inside
delimiters whose markers are neutralised, and the prompt says never to follow instructions in it. It has
intent definitions, date rules ("the 15th" written on the 20th means next month) and few-shot examples,
including a vague date and an injection attempt.

**Live adapter.** Claude via `@anthropic-ai/sdk` 1.3.0. Written from the Claude API docs bundled with the
claude-api skill (TypeScript README, Structured Outputs) and the installed typings:
- The model comes from `CLASSIFIER_MODEL`, never hard-coded. Recommended: `claude-opus-5-5`.
- Structured output via `betaZodOutputFormat(ReplyAnalysis)`, `effort: 'low'` (a short routine task), and
  server-side refusal fallback `fallbacks: 'default'` (beta `server-side-fallback-2026-07-01`), on by
  default and switchable off.
- A refusal or a truncated answer becomes "no valid output", so a human looks.
- Typed SDK errors map to timeout / rate_limited / unavailable. Usage and latency are recorded on the
  message.

**Thresholds.** Self-reported confidence is NOT calibrated (issue C4). The per-intent minimums in
`MIN_CONFIDENCE` (0.5–0.6) and the promise auto-accept threshold (0.8, `DEFAULT_REPLY_RULES`) are
provisional, chosen to send doubt to a human. They must be re-set from `pnpm classifier:eval`'s threshold
sweep on REAL recorded model outputs.

**Evaluation.** `data/classifier/labelled.jsonl` has 158 SYNTHETIC messages (all 9 intents, vague,
sarcastic, abusive, multilingual and injection). `pnpm classifier:eval`:
- replays recorded outputs and prints per-intent precision/recall, a confusion matrix, a threshold sweep,
  date accuracy and per-language results (non-English EXPERIMENTAL);
- fails on regression versus `baseline.json`.

The committed recordings come from a deterministic keyword baseline, not a model; they prove the harness
and the gate only. `pnpm eval:live` records a real model (gated, costs money). A synthetic set written by
an AI is a regression guard, NOT a measure of accuracy on real customer messages. The guide's gate of 150
real messages per language is NOT MET.
