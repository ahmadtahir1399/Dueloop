// Browser client (Supabase SSR docs, "Creating a client" for Next.js). Publishable key only.
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@dueloop/db";
import { publicEnv } from "@/lib/env";

export function createClient() {
  const { url, publishableKey } = publicEnv();
  return createBrowserClient<Database>(url, publishableKey);
}
