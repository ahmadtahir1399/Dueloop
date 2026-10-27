// Server Components / Server Actions / Route Handlers client (Supabase SSR docs for Next.js).
// It acts as the signed-in user, so Row Level Security applies to every query.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@dueloop/db";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = publicEnv();
  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, which cannot write cookies. The proxy refreshes sessions.
        }
      },
    },
  });
}
