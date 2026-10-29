// OpenAI adapter for the vendor-neutral ReplyClassifier (ADR 0029, ADR 0053). Written from the installed openai
// 7.45.1 package: the Responses API typings (responses.create, ResponseStatus, incomplete_details, output message
// content `output_text` / `refusal`, usage) and helpers/zod `zodTextFormat` (strict json_schema text format).
// The model id is configuration (env CLASSIFIER_MODEL), never hard-coded. `store: false` because the Responses
// API otherwise keeps the response (customer text) on OpenAI's side; toProposal still validates every answer.
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { ClassifierResult, ReplyClassifier } from './classifier.ts';
import type { ClassifierInput } from './input.ts';
import { CURRENT_PROMPT_VERSION, loadPrompt, renderPrompt } from './prompt.ts';
import { ReplyAnalysis } from './schema.ts';

export interface OpenAIClassifierOptions {
  /** An OpenAI model id that supports structured outputs. Required: no default model is baked in. */
  readonly model: string;
  readonly timeoutMs: number;
  /** SDK retries for 408/409/429/5xx and connection errors before we report an outage. */
  readonly maxRetries: number;
  readonly promptVersion?: string;
  /** Latency measurement without reading the clock in library code. */
  readonly nowMs: () => number;
  /** Injected for tests; otherwise a client reading OPENAI_API_KEY from the environment. */
  readonly client?: OpenAI;
}

/**
 * Strict text format for the Responses API. The schema is zodTextFormat's, minus `minLength`/`maxLength`:
 * the Structured Outputs guide ("Supported schemas", read 2026-10-29) lists only `pattern` and `format` for
 * strings, and an unsupported keyword fails the whole request. The lengths are still enforced: toProposal
 * (and parseHints for proofs) re-validate every answer with the full Zod schema.
 */
export function openAITextFormat(schema: Parameters<typeof zodTextFormat>[0], name: string) {
  const f = zodTextFormat(schema, name);
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v === null || typeof v !== 'object') return v;
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'minLength' && k !== 'maxLength').map(([k, x]) => [k, strip(x)]));
  };
  return { type: 'json_schema' as const, name: f.name, strict: true, schema: strip(f.schema) as Record<string, unknown> };
}

/** Text of the output messages, or null when the model refused or stopped early (=> a human decides). */
export function openAIOutputText(res: OpenAI.Responses.Response): string | null {
  if (res.status !== 'completed') return null;
  const parts: string[] = [];
  for (const item of res.output) {
    if (item.type !== 'message') continue;
    for (const c of item.content) {
      if (c.type === 'refusal') return null;
      if (c.type === 'output_text') parts.push(c.text);
    }
  }
  return parts.join('');
}

/** The same outage mapping as the Claude adapter: every failure retries and ends with a human, never a guess. */
export function openAIError(e: unknown): 'timeout' | 'rate_limited' | 'unavailable' | 'invalid_response' {
  if (e instanceof OpenAI.APIConnectionTimeoutError) return 'timeout';
  if (e instanceof OpenAI.RateLimitError) return 'rate_limited';
  if (e instanceof OpenAI.APIError) return 'unavailable';
  return 'invalid_response';
}

export function parseJsonOrNull(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class OpenAIReplyClassifier implements ReplyClassifier {
  readonly promptVersion: string;
  private readonly template: string;
  private readonly client: OpenAI;
  private readonly o: OpenAIClassifierOptions;

  constructor(o: OpenAIClassifierOptions) {
    if (!o.model) throw new Error('CLASSIFIER_MODEL is required');
    this.o = o;
    this.promptVersion = o.promptVersion ?? CURRENT_PROMPT_VERSION;
    this.template = loadPrompt(this.promptVersion);
    this.client = o.client ?? new OpenAI();
  }

  async classify(input: ClassifierInput): Promise<ClassifierResult> {
    const started = this.o.nowMs();
    try {
      const res = await this.client.responses.create(
        {
          model: this.o.model,
          max_output_tokens: 4096,
          store: false,
          text: { format: openAITextFormat(ReplyAnalysis, 'reply_analysis') },
          input: [{ role: 'user', content: renderPrompt(this.template, input) }],
        },
        { timeout: this.o.timeoutMs, maxRetries: this.o.maxRetries },
      );
      return {
        ok: true,
        raw: parseJsonOrNull(openAIOutputText(res)),
        modelId: res.model,
        promptVersion: this.promptVersion,
        latencyMs: this.o.nowMs() - started,
        tokensIn: res.usage?.input_tokens ?? null,
        tokensOut: res.usage?.output_tokens ?? null,
      };
    } catch (e) {
      return { ok: false, error: openAIError(e) };
    }
  }
}
