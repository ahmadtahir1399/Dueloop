// Nav counters as JSON for the polling badge refresh (ADR 0050: polling, not Realtime). Read-only, RLS applies.
import { requireTenant } from "@/lib/session";
import { loadCounters } from "@/lib/shell";

export async function GET() {
  const ctx = await requireTenant();
  return Response.json(await loadCounters(ctx), { headers: { "Cache-Control": "private, no-store" } });
}
