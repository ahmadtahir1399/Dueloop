// Rule 37 and rule 34, enforced by lint: the trusted module stays out of client code, components and staff views;
// no HTML from data. This proves the rules fire (a rule that never fires protects nothing).
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { classHeaders, contentSecurityPolicy, routeClass } from '../lib/security-headers.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({ cwd: root });
const web = (p: string) => path.join(root, 'apps/web', p);

async function messages(file: string, code: string) {
  const [r] = await eslint.lintText(code, { filePath: file });
  return (r?.messages ?? []).map((m) => m.ruleId);
}

describe('trusted-boundary lint rule', () => {
  it('blocks the trusted module in a "use client" file', async () => {
    expect(await messages(web('lib/x-client.tsx'), '"use client";\nimport { trustedPool } from "@/lib/trusted/db";\nexport const x = trustedPool;\n')).toContain('dueloopweb/trusted-boundary');
  });
  it('blocks it in shared components and staff pages, also by relative path and for pg', async () => {
    expect(await messages(web('components/x.tsx'), 'import { serviceRoleKey } from "../lib/trusted/env";\nexport const x = serviceRoleKey;\n')).toContain('dueloopweb/trusted-boundary');
    expect(await messages(web('app/(staff)/(app)/x/page.tsx'), 'import pg from "pg";\nexport default function P() { return String(pg); }\n')).toContain('dueloopweb/trusted-boundary');
  });
  it('allows it in server actions and lib data layers', async () => {
    expect(await messages(web('app/(staff)/(app)/x/actions.ts'), '"use server";\nimport { trustedPool } from "@/lib/trusted/db";\nexport async function a() { return trustedPool(); }\n')).not.toContain('dueloopweb/trusted-boundary');
    expect(await messages(web('lib/data/x.ts'), 'import { trustedPool } from "@/lib/trusted/db";\nexport const x = trustedPool;\n')).not.toContain('dueloopweb/trusted-boundary');
  });
  it('bans dangerouslySetInnerHTML and innerHTML anywhere in the web app', async () => {
    expect(await messages(web('components/y.tsx'), 'export const Y = ({ t }: { t: string }) => <div dangerouslySetInnerHTML={{ __html: t }} />;\n')).toContain('no-restricted-syntax');
    expect(await messages(web('lib/y.ts'), 'export function y(el: { innerHTML: string }, t: string) { el.innerHTML = t; }\n')).toContain('no-restricted-syntax');
  });
});

describe('header classes', () => {
  it('classifies routes', () => {
    expect(routeClass('/p/abc')).toBe('public');
    expect(routeClass('/o/abc')).toBe('public');
    expect(routeClass('/v1/invoices')).toBe('api');
    expect(routeClass('/login')).toBe('auth');
    expect(routeClass('/invoices')).toBe('staff');
    expect(routeClass('/pay')).toBe('staff'); // only /p and /p/... are public
  });
  it('public pages are no-store, no-referrer and noindex', () => {
    const h = classHeaders('public');
    expect(h['Cache-Control']).toContain('no-store');
    expect(h['Referrer-Policy']).toBe('no-referrer');
    expect(h['X-Robots-Tag']).toContain('noindex');
  });
  it('the CSP has a nonce, no unsafe-inline for scripts, and frame-ancestors none', () => {
    const csp = contentSecurityPolicy('abc', false);
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy('abc', true)).toContain("'unsafe-eval'");
  });
});
