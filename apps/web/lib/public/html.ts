// Public pages as plain server-rendered HTML (no React runtime, no client JavaScript needed; issue B, step 14).
// Every dynamic value goes through esc() (rule 34: text only). The only script is the optional copy button,
// loaded with the per-request CSP nonce; without it the page works the same.
import { EN } from "./strings";

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NO_STORE = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };

export function page(opts: { title: string; body: string; status?: number; nonce?: string | null; script?: boolean }): Response {
  const script = opts.script && opts.nonce ? `<script src="/pp-copy.js" nonce="${esc(opts.nonce)}" defer></script>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${esc(opts.title)}</title><link rel="stylesheet" href="/pp.css">${script}</head><body><main>${opts.body}</main></body></html>`;
  return new Response(html, { status: opts.status ?? 200, headers: NO_STORE });
}

/** The ONE answer for unknown, malformed, expired, revoked and wrong-purpose links (rule 39). */
export function invalidLink(): Response {
  return page({ title: EN.invalidTitle, status: 404, body: `<h1>${esc(EN.invalidTitle)}</h1><p>${esc(EN.invalidBody)}</p>` });
}
