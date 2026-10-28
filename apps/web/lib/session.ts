import "server-only";
import { can, isRole, type PermissionId, type Role } from "@dueloop/authz";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type { Role };

/** Cookie holding the tenant the user last picked. A HINT only: it is checked against memberships on every request. */
export const TENANT_COOKIE = "dl_tenant";

export interface TenantSummary {
  id: string;
  name: string;
  role: Role;
}

export interface TenantContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string | null;
  role: Role;
  tenant: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    quietStartHour: number;
    quietEndHour: number;
    outboundPaused: boolean;
  };
  /** Every tenant the user belongs to (for the switcher). */
  tenants: TenantSummary[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The verified user, or a redirect to /login. getClaims() verifies the JWT (signature + expiry); getSession()
 * would trust the cookie value (Supabase SSR docs, "Protecting pages").
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return { supabase, userId: data.claims.sub, email };
}

/**
 * Tenant and role for this request. The tenant comes from the user's memberships (read under RLS); the cookie
 * only chooses among them, so a tampered cookie falls back to the first membership. Users without a membership
 * go to onboarding.
 */
export async function requireTenant(): Promise<TenantContext> {
  const { supabase, userId, email } = await requireUser();
  const { data, error } = await supabase
    .from("memberships")
    .select("role, created_at, tenants(id, name, currency, timezone, quiet_start_hour, quiet_end_hour, outbound_paused)")
    .eq("user_id", userId)
    .order("created_at");
  if (error) throw new Error("could not load memberships");
  const rows = (data ?? []).filter((m) => m.tenants && isRole(m.role));
  if (rows.length === 0) redirect("/onboarding");

  const hint = (await cookies()).get(TENANT_COOKIE)?.value;
  const chosen = (hint && UUID.test(hint) ? rows.find((m) => m.tenants?.id === hint) : undefined) ?? rows[0];
  const t = chosen?.tenants;
  if (!chosen || !t || !isRole(chosen.role)) redirect("/onboarding");
  return {
    supabase,
    userId,
    email,
    role: chosen.role,
    tenant: {
      id: t.id,
      name: t.name,
      currency: t.currency,
      timezone: t.timezone,
      quietStartHour: t.quiet_start_hour,
      quietEndHour: t.quiet_end_hour,
      outboundPaused: t.outbound_paused,
    },
    tenants: rows.flatMap((m) => (m.tenants && isRole(m.role) ? [{ id: m.tenants.id, name: m.tenants.name, role: m.role }] : [])),
  };
}

/** requireTenant + a role gate. A screen the role may not use answers 404, so the URL confirms nothing. */
export async function requirePermission(permission: PermissionId): Promise<TenantContext> {
  const ctx = await requireTenant();
  if (!can(ctx.role, permission)) notFound();
  return ctx;
}

export const canImport = (role: Role) => can(role, "import.run");
