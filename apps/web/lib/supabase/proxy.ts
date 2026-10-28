// Session refresh on staff requests (Supabase SSR docs, "Hook up proxy"). Returns the response that carries
// refreshed cookies; when `protect` is set, unauthenticated visitors are sent to /login.
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@dueloop/db";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";

export async function updateSession(request: NextRequest, requestHeaders: Headers, protect: boolean) {
  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
  const { url, publishableKey } = publicEnv();

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value));
      },
    },
  });

  // Do not run code between createServerClient and getClaims() (Supabase docs).
  // getClaims() verifies the token; getSession() would trust the cookie blindly.
  const { data } = await supabase.auth.getClaims();

  if (protect && !data?.claims) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    // Carry refreshed session cookies and cache headers over (Supabase docs). Next 16.4's
    // ResponseCookies has no setAll(), so copy them one by one.
    const redirect = NextResponse.redirect(redirectUrl);
    for (const cookie of supabaseResponse.cookies.getAll()) redirect.cookies.set(cookie);
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = supabaseResponse.headers.get(header);
      if (value) redirect.headers.set(header, value);
    }
    return redirect;
  }
  return supabaseResponse;
}
