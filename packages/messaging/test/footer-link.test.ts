// Prompt 6 (issue F/L): the footer is appended after rendering and carries the opt-out link when one was issued.
import { describe, expect, it } from 'vitest';
import { appendFooter, FOOTER_SEPARATOR } from '../src/index.ts';

describe('appendFooter with an opt-out link', () => {
  it('keeps the reply-STOP text and adds the link after it', () => {
    const out = appendFooter('Body text', 'email', 'en', 'https://pay.example.test/o/TOKEN');
    expect(out.startsWith(`Body text${FOOTER_SEPARATOR}`)).toBe(true);
    expect(out).toContain('reply STOP');
    expect(out.endsWith('Or stop them here: https://pay.example.test/o/TOKEN')).toBe(true);
  });
  it('is unchanged without a link (prompt 3 behaviour)', () => {
    expect(appendFooter('B', 'email', 'en')).toBe(`B${FOOTER_SEPARATOR}You are receiving this because you have an open invoice with us. To stop these reminders, reply STOP.`);
  });
  it('an edited body cannot remove it: the footer always comes last', () => {
    const edited = `Pay now${FOOTER_SEPARATOR}fake footer`;
    expect(appendFooter(edited, 'email', 'en', 'https://x.test/o/T').endsWith('https://x.test/o/T')).toBe(true);
  });
});
