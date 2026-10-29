// Readiness: the database is reachable and its schema is the one this build expects (rule 45). Answers 503 with
// a reason code (never a value) otherwise, and records a heartbeat for ops:status.
import { readiness } from "@/lib/trusted/ready";

export const runtime = "nodejs";
export async function GET() {
  const r = await readiness();
  return Response.json(r, { status: r.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
