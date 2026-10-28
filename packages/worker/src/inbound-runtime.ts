// Composition root for the inbound processor: classifier choice, notifier, logger. Failpoints are always the
// no-op here (tests build their own deps).
import { AnthropicReplyClassifier, type ClassifierResult, type ReplyClassifier } from '@dueloop/classifier';
import { DEFAULT_INBOUND_CONFIG, InboundDb, NO_INBOUND_FAILPOINTS, type InboundDeps } from '@dueloop/inbound';
import type { WorkerDb } from './db.ts';
import type { Clock } from './ports.ts';
import { buildDeps } from './runtime.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * With no classifier configured, every reply goes to a human (no output => human_review). Safe by default:
 * nothing is guessed and nothing is lost.
 */
export class HumanOnlyClassifier implements ReplyClassifier {
  readonly promptVersion = 'human-only';
  async classify(): Promise<ClassifierResult> {
    return { ok: true, raw: null, modelId: 'none', promptVersion: this.promptVersion, latencyMs: 0, tokensIn: null, tokensOut: null };
  }
}

export function classifierFrom(env: Env, nowMs: () => number): ReplyClassifier {
  if (env.CLASSIFIER === 'anthropic') {
    return new AnthropicReplyClassifier({
      model: env.CLASSIFIER_MODEL ?? '',
      timeoutMs: Number(env.CLASSIFIER_TIMEOUT_MS ?? 30_000),
      maxRetries: 2,
      effort: 'low',
      fallbacks: env.CLASSIFIER_FALLBACKS !== 'false',
      nowMs,
    });
  }
  return new HumanOnlyClassifier();
}

export function buildInboundDeps(env: Env, workerDb: WorkerDb, clock: Clock, classifier: ReplyClassifier): InboundDeps {
  const w = buildDeps(env, workerDb, clock); // same logger and the same Slack-or-email alert routing
  return {
    db: new InboundDb(workerDb.pool),
    classifier,
    clock,
    logger: w.logger,
    notifier: w.notifier,
    failpoints: NO_INBOUND_FAILPOINTS,
    config: DEFAULT_INBOUND_CONFIG,
  };
}
