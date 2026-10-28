// Request interception (Next.js 16 calls this file "proxy"; it replaced middleware.ts). Two jobs:
// 1. Security headers per route class, with a fresh CSP nonce per request (Next.js CSP guide).
// 2. For staff routes only: refresh the Supabase session (Supabase SSR docs) and send signed-out users to /login.
// Public link pages and the REST API never touch the session cookie (rule 35: a GET creates no session).
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { classHeaders, contentSecurityPolicy, FILE_CSP, routeClass } from "@/lib/security-headers";

export async function proxy(request: NextRequest) {
  const cls = routeClass(request.nextUrl.pathname);
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response =
    cls === "staff" || cls === "auth" || cls === "file"
      ? await updateSession(request, requestHeaders, cls !== "auth")
      : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", cls === "file" ? FILE_CSP : csp);
  for (const [k, v] of Object.entries(classHeaders(cls))) response.headers.set(k, v);
  return response;
}

export const config = {
  // Skip static files and images (Supabase docs matcher).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
