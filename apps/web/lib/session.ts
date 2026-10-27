import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "accountant" | "collector";

export interface TenantContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string | null;
  role: Role;
  tenant: { id: string; name: string; currency: string; timezone: string; quietStartHour: number; quietEndHour: number };
}

/** The verified user (getClaims checks the token signature), or a redirect to /login. */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return { supabase, userId: data.claims.sub, email };
}

/** The user's (first) tenant and role; users without a membership are sent to onboarding. */
export async function requireTenant(): Promise<TenantContext> {
  const { supabase, userId, email } = await requireUser();
  const { data } = await supabase
    .from("memberships")
    .select("role, created_at, tenants(id, name, currency, timezone, quiet_start_hour, quiet_end_hour)")
    .eq("user_id", userId)
    .order("created_at")
    .limit(1);
  const m = data?.[0];
  if (!m?.tenants) redirect("/onboarding");
  const t = m.tenants;
  return {
    supabase,
    userId,
    email,
    role: m.role as Role,
    tenant: {
      id: t.id,
      name: t.name,
      currency: t.currency,
      timezone: t.timezone,
      quietStartHour: t.quiet_start_hour,
      quietEndHour: t.quiet_end_hour,
    },
  };
}

export const canImport = (role: Role) => role === "owner" || role === "accountant";
