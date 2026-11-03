// §7.3 token bridge: every shadcn variable points at the Dueloop token the spec's table names, and the lime brand
// accent is never shadcn's --accent (which shadcn uses for hover/highlight backgrounds).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/globals.css', import.meta.url), 'utf8');
const start = css.indexOf('{', css.indexOf('shadcn variable names'));
const body = css.slice(start + 1, css.indexOf('}', start));
const map = Object.fromEntries(
  body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const [k, ...v] = d.split(':');
      return [k?.trim(), v.join(':').trim()];
    }),
);

const BRIDGE: Record<string, string> = {
  '--background': 'var(--color-bg)',
  '--foreground': 'var(--color-text)',
  '--card': 'var(--color-surface)',
  '--card-foreground': 'var(--color-text)',
  '--popover': 'var(--color-surface)',
  '--popover-foreground': 'var(--color-text)',
  '--primary': 'var(--color-primary)',
  '--primary-foreground': 'var(--color-on-primary)',
  '--secondary': 'var(--color-surface-sunken)',
  '--secondary-foreground': 'var(--color-text)',
  '--muted': 'var(--color-surface-sunken)',
  '--muted-foreground': 'var(--color-text-muted)',
  '--accent': 'var(--color-primary-soft)',
  '--accent-foreground': 'var(--color-primary-soft-text)',
  '--destructive': 'var(--color-error-text)',
  '--border': 'var(--color-border)',
  '--input': 'var(--color-border-strong)',
  '--ring': 'var(--color-focus-ring)',
  '--radius': 'var(--radius-md)',
};

describe('shadcn → Dueloop token bridge (§7.3)', () => {
  it('maps every shadcn variable exactly as the spec table says', () => {
    expect(map).toEqual(BRIDGE);
  });
  it('never maps the lime accent onto shadcn variables', () => {
    expect(body).not.toMatch(/--color-accent\b/);
  });
});
