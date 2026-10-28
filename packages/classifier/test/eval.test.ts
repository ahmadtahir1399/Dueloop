// The evaluation harness itself: metrics are computed from recordings, and the regression gate can fail.
import { describe, expect, it } from 'vitest';
import { evaluate, labelled, inputFor, regressions, type RecordingLine } from '../eval/harness.ts';
import { keywordAnalysis } from '../eval/keyword-baseline.ts';
import { inputHash } from '../src/input.ts';

const items = labelled();
const rec = (raw: (id: string, i: ReturnType<typeof inputFor>) => unknown): RecordingLine[] =>
  items.map((it) => {
    const input = inputFor(it);
    return { id: it.id, hash: inputHash(input, 'reply-v1'), modelId: 'test', raw: raw(it.id, input) };
  });

describe('classifier eval harness', () => {
  it('the labelled set is synthetic, covers all 9 intents and has at least 150 messages', () => {
    expect(items.length).toBeGreaterThanOrEqual(150);
    expect(new Set(items.map((i) => i.label)).size).toBe(9);
    expect(items.every((i) => i.source === 'synthetic')).toBe(true);
  });

  it('perfect recordings => accuracy 1; invalid outputs count as the "invalid" column', () => {
    const label = (id: string) => items.find((i) => i.id === id)?.label;
    const perfect = evaluate(items, rec((id, input) => ({ ...keywordAnalysis(input), intent: label(id) })), 'reply-v1');
    expect(perfect.accuracy).toBe(1);
    const broken = evaluate(items, rec(() => ({ intent: 'paid' })), 'reply-v1');
    expect(broken.accuracy).toBe(0);
    expect(broken.confusion.dispute?.invalid).toBe(16);
  });

  it('the regression gate fails on a worse model and on missing recordings', () => {
    const good = evaluate(items, rec((_id, input) => keywordAnalysis(input)), 'reply-v1');
    const baseline = { recording: 'x', macroF1: good.macroF1, recall: Object.fromEntries(Object.entries(good.perIntent).map(([k, v]) => [k, v.recall])) };
    expect(regressions(good, baseline)).toEqual([]);
    const worse = evaluate(items, rec((_id, input) => ({ ...keywordAnalysis(input), intent: 'unclear' })), 'reply-v1');
    expect(regressions(worse, baseline).length).toBeGreaterThan(0);
    const partial = evaluate(items, rec((_id, input) => keywordAnalysis(input)).slice(10), 'reply-v1');
    expect(regressions(partial, baseline)[0]).toMatch(/no recorded output/);
  });
});
