// Which AI provider the processor and the proof inbox use is configuration only (ADR 0053).
import { AnthropicReplyClassifier, OpenAIReplyClassifier } from '@dueloop/classifier';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifierFrom, HumanOnlyClassifier } from '../src/inbound-runtime.ts';

const saved = process.env.OPENAI_API_KEY;
beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-key'; // the SDK reads it; nothing is called
});
afterEach(() => {
  if (saved === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = saved;
});

describe('classifierFrom', () => {
  it('CLASSIFIER=openai => the OpenAI adapter with the configured model', () => {
    expect(classifierFrom({ CLASSIFIER: 'openai', CLASSIFIER_MODEL: 'test-model' }, () => 0)).toBeInstanceOf(OpenAIReplyClassifier);
  });
  it('CLASSIFIER=anthropic => the Claude adapter', () => {
    expect(classifierFrom({ CLASSIFIER: 'anthropic', CLASSIFIER_MODEL: 'test-model' }, () => 0)).toBeInstanceOf(AnthropicReplyClassifier);
  });
  it('unset or unknown => every reply goes to a human', () => {
    expect(classifierFrom({}, () => 0)).toBeInstanceOf(HumanOnlyClassifier);
    expect(classifierFrom({ CLASSIFIER: 'gpt' }, () => 0)).toBeInstanceOf(HumanOnlyClassifier);
  });
  it('a provider without a model refuses to start', () => {
    expect(() => classifierFrom({ CLASSIFIER: 'openai' }, () => 0)).toThrow(/CLASSIFIER_MODEL/);
  });
});
