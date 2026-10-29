# 0053: OpenAI as a second model provider for replies and proof hints

**Context.** The owner asked to be able to use OpenAI. The classifier boundary (ADR 0029) and the proof extractor
(ADR 0040) were already vendor-neutral interfaces with one live adapter each (Claude).

**Decision.** Add `OpenAIReplyClassifier` (`packages/classifier/src/openai.ts`) and `OpenAIProofExtractor`
(`packages/proofs/src/extract.ts`) next to the Claude adapters. The provider is configuration only:
- `CLASSIFIER=openai` and/or `PROOF_EXTRACTION=openai`, the model id in `CLASSIFIER_MODEL` /
  `PROOF_EXTRACTION_MODEL` (required, never hard-coded), and the key in `OPENAI_API_KEY`.
- Anthropic stays the other choice. With no provider set, every reply still goes to a human and proofs get no hints.

**How it was written.** From the installed `openai` 7.45.1 package (Responses API typings, `helpers/zod`), and OpenAI's
Structured Outputs guide (read 2026-10-29):
- `responses.create` with a strict `json_schema` text format built from the same Zod schemas.
- `minLength`/`maxLength` are removed from the schema sent to OpenAI because the guide's supported-keyword list for
  strings has only `pattern` and `format`, and an unsupported keyword fails the request. The lengths are still
  enforced: `toProposal` and `parseHints` validate every answer with the full Zod schema.
- `store: false`, so the customer's text or bank screenshot is not kept as a stored response object.
- Images go as a base64 data URL in an `input_image` part (`detail: 'auto'`).
- A refusal, a non-`completed` status or non-JSON text becomes "no valid output" (a human looks). Typed SDK errors
  map to timeout / rate_limited / unavailable, exactly like the Claude adapter.
- There is no equivalent of Claude's server-side fallback, so the `*_FALLBACKS` variables apply to Anthropic only.

**After review (round 1).**
- Logging: every AI client (OpenAI and Claude) is built with `logLevel: 'off'`, which beats `OPENAI_LOG` /
  `ANTHROPIC_LOG`. At `debug` the SDKs print request and response bodies: customer replies and bank screenshots
  (rules 20, 25).
- Reasoning models: `max_output_tokens` covers reasoning tokens too. The limits are now 16384 (replies) and 8192
  (proofs), and `CLASSIFIER_REASONING_EFFORT` / `PROOF_EXTRACTION_REASONING_EFFORT` send `reasoning.effort` when
  set (never by default, because models without reasoning reject the field). An answer cut short still goes to a
  human.
- Known limit: the length limits removed from the wire schema are stated in the prompt only for `summary`. A model
  that copies a very long date phrase into `promisedDateText` produces output that `toProposal` rejects, so that
  reply goes to a human. Fixing it means a new prompt version (and a new recorded evaluation), so it is left open.

**Unchanged.** Rule 21 (model output can only become a Proposal or an untrusted hint), rule 26 (dates are checked by
`validatePromiseDate`), rule 31 (an extracted amount never confirms money). The demo refuses to start when
`OPENAI_API_KEY` is set, like `ANTHROPIC_API_KEY`. The secret scanner knows OpenAI's key prefixes.

**Verified.** Contract tests through the real SDK with an injected fetch (`packages/classifier/test/openai.contract.test.ts`,
`packages/proofs/test/openai.contract.test.ts`) and the provider selection test (`packages/worker/test/providers.test.ts`).
NOT VERIFIED: a call to the real OpenAI API (no key in this session), accuracy of any OpenAI model on the labelled
set, and OpenAI's own data-retention terms.
