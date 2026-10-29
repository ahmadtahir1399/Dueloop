// Response headers per route class (rules 35-37, issue G). Pure: the proxy and the tests both use it.
// Sources: Next.js 16 "Content Security Policy" guide (nonce via proxy, 'strict-dynamic', dev needs
// 'unsafe-eval'); MDN for Referrer-Policy, X-Robots-Tag and frame-ancestors.

export type RouteClass = "staff" | "public" | "api" | "auth" | "file";

/** Untrusted files (proof images/PDFs) are served under this CSP: no script, no plugins, no requests. */
export const FILE_CSP = "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'";

/** Which class a path belongs to. Public link pages live under /p (pay) and /o (opt-out); the REST API under /v1. */
export function routeClass(pathname: string): RouteClass {
  if (/^\/proofs\/[^/]+\/file$/.test(pathname)) return "file";
  if (pathname === "/p" || pathname.startsWith("/p/") || pathname === "/o" || pathname.startsWith("/o/")) return "public";
  if (pathname === "/v1" || pathname.startsWith("/v1/") || pathname === "/health" || pathname === "/ready") return "api";
  if (pathname.startsWith("/login") || pathname.startsWith("/auth")) return "auth";
  return "staff";
}

/**
 * form-action for the public pages. Browsers apply form-action to the REDIRECT after a form POST, so "Pay now"
 * (a POST answered with 303 to the provider's hosted checkout) needs the provider origins here. Stripe hosts
 * Checkout on checkout.stripe.com and Payment Links on buy.stripe.com (Stripe docs; live checkout NOT VERIFIED).
 * The FakeGateway origin is added only when the fake gateway is enabled (tests and demo).
 */
export function publicFormAction(allowFake: boolean): string {
  return ["'self'", "https://checkout.stripe.com", "https://buy.stripe.com", ...(allowFake ? ["https://pay.fake.test"] : [])].join(" ");
}

export function contentSecurityPolicy(nonce: string, dev: boolean, formAction = "'self'"): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonce-carrying Next.js bootstrap load its own chunks; nothing inline without the nonce.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Exception (documented in ADR 0047): style ATTRIBUTES. Radix/shadcn render a few inline style attributes
    // (positioning). Attributes cannot carry script; a nonce cannot cover them.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
    "frame-src 'self'",
  ].join("; ");
}

/** Headers every response class gets, plus the class-specific ones. CSP is added by the proxy (it needs the nonce). */
export function classHeaders(cls: RouteClass): Record<string, string> {
  const common: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
  switch (cls) {
    case "public":
      return {
        ...common,
        "Cache-Control": "no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      };
    case "api":
      return { ...common, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
    case "file":
      return { ...common, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
    case "auth":
    case "staff":
      return {
        ...common,
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "same-origin",
        "X-Robots-Tag": "noindex, nofollow",
      };
  }
}
