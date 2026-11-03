// D13: every invoice status renders an icon AND a word (never colour alone); values come from core.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { INVOICE_STATUSES } from '@dueloop/core';
import { STATUS_VISUAL, StatusChip } from '../components/ui/status-chip.tsx';

describe('StatusChip', () => {
  it('covers every status in core', () => expect(Object.keys(STATUS_VISUAL).sort()).toEqual([...INVOICE_STATUSES].sort()));
  for (const s of INVOICE_STATUSES) {
    it(`${s}: icon + label`, () => {
      const html = renderToStaticMarkup(createElement(StatusChip, { status: s }));
      expect(html).toContain('<svg');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(STATUS_VISUAL[s].label);
    });
  }
});
