// D1 and §3.1.2: contrast pairs pass, forbidden pairs fail, and the dark block in tokens.css covers every light token.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check, contrast, DARK, FORBIDDEN, LIGHT } from '../lib/contrast.ts';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

function block(after: string): string {
  const start = css.indexOf('{', css.indexOf(after)) + 1;
  let depth = 1;
  let i = start;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  return css.slice(start, i - 1);
}
const decls = (body: string) => body.split(';').map((d) => d.replace(/\s+/g, ' ').trim()).filter(Boolean).sort();

describe('contrast (WCAG 2.x)', () => {
  it('reproduces known ratios', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });
  it('every light and dark pair passes and matches the spec table', () => {
    for (const r of [...check(LIGHT), ...check(DARK)]) {
      expect(r.ok, r.pair.name).toBe(true);
      expect(r.specMatches, `${r.pair.name}: ${r.ratio.toFixed(2)}`).toBe(true);
    }
  });
  it('forbidden pairs really fail', () => {
    for (const r of check(FORBIDDEN, true)) expect(r.ok, r.pair.name).toBe(true);
  });
});

describe('tokens.css', () => {
  it('one class-based dark block (§3.1.4) overrides every light semantic token, and nothing else selects a theme', () => {
    const names = (body: string) => decls(body.replace(/\/\*[\s\S]*?\*\//g, '')).map((d) => d.split(':')[0]);
    const light = names(block(':root,\n.light'));
    const dark = names(block('\n.dark {'));
    expect(light.length).toBeGreaterThan(30);
    expect(dark).toEqual(light.filter((n) => n !== '--elev-0')); // elev-0 is "none" in both themes
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).not.toContain('data-theme');
  });
  it('every colour used in a checked pair is a token value', () => {
    for (const p of [...LIGHT, ...DARK]) {
      expect(css.toUpperCase(), p.fg).toContain(p.fg.toUpperCase());
      expect(css.toUpperCase(), p.bg).toContain(p.bg.toUpperCase());
    }
  });
});
