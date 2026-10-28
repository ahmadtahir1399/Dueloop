import "server-only";
import type { CounterKey } from "@/lib/nav";
import type { TenantContext } from "@/lib/session";

/** Nav counters from one cheap RPC (RLS applies). A failure only hides the badges; it never blocks the page. */
export async function loadCounters(ctx: TenantContext): Promise<Partial<Record<CounterKey, number>>> {
  const { data, error } = await ctx.supabase.rpc("nav_counters", { p_tenant: ctx.tenant.id });
  const row = data?.[0];
  if (error || !row) return {};
  return {
    approvals: Number(row.approvals),
    tasks: Number(row.tasks),
    unknownMessages: Number(row.unknown_messages),
    proofs: Number(row.proofs),
  };
}

/** Global kill switch as a boolean (system_flags stay service-only). Unknown counts as "not shown", never as paused-off. */
export async function loadGlobalPause(ctx: TenantContext): Promise<boolean> {
  const { data, error } = await ctx.supabase.rpc("is_globally_paused");
  return !error && data === true;
}
