// Live test, 2026-11-06, two CSP gaps (style-src and script-src are nonce-only, lib/security-headers.ts):
// 1. sonner 2.x injects its whole stylesheet as a <style> tag WITHOUT a nonce (dist/index.mjs __insertCSS; there is
//    no nonce option), so the browser blocks it and every toast renders unstyled. The same CSS ships as
//    `sonner/dist/styles.css`; importing it puts the rules in the app's own bundled CSS, which 'self' allows.
// 2. app/global-not-found.tsx was prerendered at build time, so none of its scripts carried a nonce and CSP blocked
//    all of them. A nonce needs per-request rendering (Next.js CSP guide, "Forcing dynamic rendering").
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const web = (p: string) => readFileSync(path.resolve(import.meta.dirname, '..', p), 'utf8');
const require = createRequire(import.meta.url);

describe('toasts under the nonce-only style-src', () => {
  it('the Toaster imports sonner\'s stylesheet (bundled, served from self)', () => {
    expect(web('components/ui/sonner.tsx')).toMatch(/^import ["']sonner\/dist\/styles\.css["'];?$/m);
  });

  it('that stylesheet holds the rules sonner would otherwise inject inline', () => {
    const css = readFileSync(require.resolve('sonner/dist/styles.css'), 'utf8');
    expect(css).toContain('[data-sonner-toaster]');
    // The file is the unminified form of the injected string ([data-styled='true'] vs [data-styled=true]).
    expect(css).toMatch(/\[data-sonner-toast\]\[data-styled=['"]?true['"]?\]/);
  });
});

describe('global 404 under the nonce-only script-src', () => {
  it('renders per request, so Next.js can attach the nonce to its scripts', () => {
    const src = web('app/global-not-found.tsx');
    expect(src).toMatch(/import \{ connection \} from ["']next\/server["']/);
    expect(src).toMatch(/export default async function GlobalNotFound\(\)/);
    expect(src).toMatch(/await connection\(\)/);
  });
});
