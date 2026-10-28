// Vendor-neutral classifier boundary. Implementations return the model's RAW output; toProposal validates it.
import { inputHash, type ClassifierInput } from './input.ts';

export type ClassifierResult =
  | {
      readonly ok: true;
      readonly raw: unknown;
      readonly modelId: string;
      readonly promptVersion: string;
      readonly latencyMs: number;
      readonly tokensIn: number | null;
      readonly tokensOut: number | null;
    }
  /** Outage or provider error: the pipeline retries via the event queue; the message is never lost. */
  | { readonly ok: false; readonly error: 'timeout' | 'unavailable' | 'rate_limited' | 'refused' | 'invalid_response' | 'not_recorded' };

export interface ReplyClassifier {
  readonly promptVersion: string;
  classify(input: ClassifierInput): Promise<ClassifierResult>;
}

/** Deterministic classifier for tests and demos: a function of the input. */
export class FakeClassifier implements ReplyClassifier {
  readonly promptVersion: string;
  readonly calls: ClassifierInput[] = [];
  private readonly respond: (input: ClassifierInput) => unknown;
  constructor(respond: (input: ClassifierInput) => unknown, promptVersion = 'fake') {
    this.respond = respond;
    this.promptVersion = promptVersion;
  }
  async classify(input: ClassifierInput): Promise<ClassifierResult> {
    this.calls.push(input);
    const raw = this.respond(input);
    if (raw instanceof Error) return { ok: false, error: 'unavailable' };
    return { ok: true, raw, modelId: 'fake', promptVersion: this.promptVersion, latencyMs: 0, tokensIn: null, tokensOut: null };
  }
}

export interface Recording {
  readonly hash: string;
  readonly modelId: string;
  readonly raw: unknown;
}

/** Replays committed model outputs keyed by input hash (no network). Unknown input => 'not_recorded'. */
export class RecordedClassifier implements ReplyClassifier {
  readonly promptVersion: string;
  private readonly byHash: Map<string, Recording>;
  constructor(recordings: readonly Recording[], promptVersion: string) {
    this.promptVersion = promptVersion;
    this.byHash = new Map(recordings.map((r) => [r.hash, r]));
  }
  async classify(input: ClassifierInput): Promise<ClassifierResult> {
    const r = this.byHash.get(inputHash(input, this.promptVersion));
    if (!r) return { ok: false, error: 'not_recorded' };
    return { ok: true, raw: r.raw, modelId: r.modelId, promptVersion: this.promptVersion, latencyMs: 0, tokensIn: null, tokensOut: null };
  }
}
