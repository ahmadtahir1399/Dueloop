// The pipeline stores untrustedSummary; the pages read summary, so no AI summary was ever shown (found 2026-11-02).
import { describe, expect, it } from 'vitest';
import { aiSummaryOf } from '../lib/ai-summary.ts';

describe('aiSummaryOf', () => {
  it('reads the summary the inbound pipeline stores', () => {
    expect(aiSummaryOf({ intent: 'promise_to_pay', untrustedSummary: 'Will pay on the 15th.' })).toBe('Will pay on the 15th.');
  });

  it.each([
    ['an opt-out keyword (no model ran)', { intent: 'opt_out', untrustedSummary: '' }],
    ['a review with no summary', { review: 'invalid_output', untrustedSummary: null }],
    ['only spaces', { untrustedSummary: '   ' }],
    ['the wrong type', { untrustedSummary: 7 }],
    ['a stray summary key', { summary: 'not ours' }],
    ['no analysis', null],
    ['not an object', 'text'],
  ])('%s shows nothing', (_name, analysis) => {
    expect(aiSummaryOf(analysis)).toBeNull();
  });
});
