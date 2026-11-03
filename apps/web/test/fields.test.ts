// D22 (redesign §7.3): one field system. Scans the web app's React code (app/, components/, features/) for native
// form controls written outside components/ui. The rule:
//   - no native <select> anywhere: selects are components/ui/select (ChoiceSelect / Combobox build on it);
//   - no raw <textarea> outside components/ui: use components/ui/textarea;
//   - no raw <input> outside components/ui, except type="hidden" (form plumbing, never visible);
//   - components/theme-toggle.tsx keeps native radios: §3.1.4 requires the theme control to be native radio inputs.
// Out of scope: app/(public)/** and lib/public/** (customer pages are server-built HTML strings, not React; §4.7) and
// features/landing/three/** (WebGL scene, no form controls).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = path.resolve(__dirname, '..');
const ROOTS = ['app', 'components', 'features'];
const SKIP = [/^app[\\/]\(public\)/, /^features[\\/]landing[\\/]three/];
const UI = /^components[\\/]ui[\\/]/;
const NATIVE_RADIO_ALLOWED = new Set(['components/theme-toggle.tsx']);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Source without comments, so prose like "a native <select>" in a comment does not count. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, '')))
    .join('\n');
}

const sources = ROOTS.flatMap((r) => files(path.join(WEB, r)))
  .map((f) => ({ rel: path.relative(WEB, f).replace(/\\/g, '/'), src: code(readFileSync(f, 'utf8')) }))
  .filter((f) => !SKIP.some((re) => re.test(f.rel)));

describe('D22: one field system (shadcn Input / Textarea / Select)', () => {
  it('scans a realistic number of files', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('has no native <select> element', () => {
    const hits = sources.filter((f) => /<select\b/.test(f.src)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it('has no raw <textarea> outside components/ui', () => {
    const hits = sources.filter((f) => !UI.test(f.rel) && /<textarea\b/.test(f.src)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it('has no raw <input> outside components/ui except hidden inputs (and the native theme radios)', () => {
    const hits: string[] = [];
    for (const f of sources) {
      if (UI.test(f.rel)) continue;
      for (const m of f.src.matchAll(/<input\b[\s\S]*?\/>/g)) {
        const tag = m[0];
        if (/type="hidden"/.test(tag)) continue;
        if (NATIVE_RADIO_ALLOWED.has(f.rel) && /type="radio"/.test(tag)) continue;
        hits.push(`${f.rel}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('text fields come from @/components/ui/input (Field/MoneyInput/SearchInput build on it)', () => {
    const field = readFileSync(path.join(WEB, 'components/ui/field.tsx'), 'utf8');
    expect(field).toContain('from "@/components/ui/input"');
    expect(readFileSync(path.join(WEB, 'components/ui/choice-select.tsx'), 'utf8')).toContain('from "@/components/ui/select"');
  });
});
