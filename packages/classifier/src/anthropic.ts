// Claude adapter for the vendor-neutral ReplyClassifier (ADR 0029). Written from the Claude API docs bundled
// with the claude-api skill (TypeScript README + tool-use.md "Structured Outputs") and the installed
// @anthropic-ai/sdk 1.3.0 typings. The model id is configuration (env CLASSIFIER_MODEL), never hard-coded.
// Structured output constrains the reply to ReplyAnalysis; toProposal still validates it independently.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ClassifierResult, ReplyClassifier } from './classifier.ts';
import type { ClassifierInput } from './input.ts';
import { CURRENT_PROMPT_VERSION, loadPrompt, renderPrompt } from './prompt.ts';
import { ReplyAnalysis } from './schema.ts';

export interface AnthropicClassifierOptions {
  /** e.g. "claude-opus-5-5" (recommended). Required: no default model is baked in. */
  readonly model: string;
  readonly timeoutMs: number;
  /** SDK retries for 408/409/429/5xx and connection errors before we report an outage. */
  readonly maxRetries: number;
  /** Classification is a short, routine task: 'low' effort is the documented starting point. */
  readonly effort: 'low' | 'medium' | 'high';
  /** Server-side refusal fallback ("default" routing). On by default; set false on platforms without it. */
  readonly fallbacks: boolean;
  readonly promptVersion?: string;
  /** Latency measurement without reading the clock in library code. */
  readonly nowMs: () => number;
  /** Injected for tests; otherwise a client resolving credentials from the environment. */
  readonly client?: Anthropic;
}

export class AnthropicReplyClassifier implements ReplyClassifier {
  readonly promptVersion: string;
  private readonly template: string;
  private readonly client: Anthropic;
  private readonly o: AnthropicClassifierOptions;

  constructor(o: AnthropicClassifierOptions) {
    if (!o.model) throw new Error('CLASSIFIER_MODEL is required');
    this.o = o;
    this.promptVersion = o.promptVersion ?? CURRENT_PROMPT_VERSION;
    this.template = loadPrompt(this.promptVersion);
    // logLevel 'off' beats ANTHROPIC_LOG, whose 'debug' level would log request bodies (customer text).
    this.client = o.client ?? new Anthropic({ logLevel: 'off' });
  }

  async classify(input: ClassifierInput): Promise<ClassifierResult> {
    const started = this.o.nowMs();
    try {
      const res = await this.client.beta.messages.create(
        {
          model: this.o.model,
          max_tokens: 4096,
          ...(this.o.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          output_config: { effort: this.o.effort, format: betaZodOutputFormat(ReplyAnalysis) },
          messages: [{ role: 'user', content: renderPrompt(this.template, input) }],
        },
        { timeout: this.o.timeoutMs, maxRetries: this.o.maxRetries },
      );
      const meta = { modelId: res.model, promptVersion: this.promptVersion, latencyMs: this.o.nowMs() - started, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens };
      // A refusal or a truncated answer is "no valid output": toProposal sends the reply to a human.
      if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return { ok: true, raw: null, ...meta };
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      let raw: unknown = null;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = null;
      }
      return { ok: true, raw, ...meta };
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, error: 'timeout' };
      if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'rate_limited' };
      if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) return { ok: false, error: 'unavailable' };
      // 4xx other than 429 (bad key, bad model id, bad request): an outage from our side; the event retries
      // and dead-letters to a human task rather than losing the message.
      if (e instanceof Anthropic.APIError) return { ok: false, error: 'unavailable' };
      return { ok: false, error: 'invalid_response' };
    }
  }
}
