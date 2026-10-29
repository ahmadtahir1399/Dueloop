// Liveness: the process is up. No database call, no session, no data.
export const runtime = "nodejs";
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
