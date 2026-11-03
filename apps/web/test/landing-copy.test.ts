// §4.9.4: the landing copy is verbatim from the spec, and claims nothing beyond it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COPY } from '../features/landing/copy.ts';

const spec = readFileSync(new URL('../../../docs/redesign/REDESIGN.md', import.meta.url), 'utf8');
const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

// The repo's REDESIGN.md is v1.0 (no landing page); the copy deck is in v1.1 (CONFLICTS C-29). Until v1.1 is
// committed this check is reported as skipped, never as passed.
const hasV11 = spec.includes('4.9.4 Copy deck');

describe('landing copy deck', () => {
  it.skipIf(!hasV11)('every string appears verbatim in REDESIGN.md v1.1 (skipped: v1.1 not in the repo)', () => {
    for (const s of strings(COPY)) expect(spec.includes(s), s).toBe(true);
  });
  it('makes no pricing, testimonial, statistic or compliance claim', () => {
    const all = strings(COPY).join(' ').toLowerCase();
    for (const banned of ['price', 'pricing', '$', 'trusted by', 'customers love', '%', 'gdpr', 'compliant', 'certified', 'sms']) {
      expect(all.includes(banned), banned).toBe(false);
    }
  });
});
