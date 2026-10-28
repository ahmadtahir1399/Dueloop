// Proof file viewing (handoff from prompt 5: server-side createSignedUrl, 300 s). The browser never sees the
// storage URL or the service-role key: this route checks the session and tenant, signs a short-lived URL on the
// server, fetches the bytes and streams them back with headers that keep them inert:
// - Content-Type from OUR row (validated by magic bytes at ingest), nosniff;
// - CSP `sandbox; default-src 'none'`: even an HTML-pretending file cannot run script or load anything;
// - images inline, PDFs as a download (browsers refuse to render PDFs in a sandbox; a download is never executed
//   by the browser); the filename is generated, never the customer's.
import { can } from "@dueloop/authz";
import { requireTenant } from "@/lib/session";
import { proofViewUrl } from "@/lib/trusted/ops";

const MAX_BYTES = 10 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export async function GET(_req: Request, ctxArg: RouteContext<"/proofs/[id]/file">) {
  const ctx = await requireTenant();
  const { id } = await ctxArg.params;
  if (!can(ctx.role, "proofs.view") || !/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const signed = await proofViewUrl(ctx, id);
  if (!signed.ok || !EXT[signed.value.mime]) return new Response("Not found", { status: 404 });
  const upstream = await fetch(signed.value.url, { redirect: "error", cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new Response("Unavailable", { status: 502 });
  const len = Number(upstream.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return new Response("Too large", { status: 502 });
  const isPdf = signed.value.mime === "application/pdf";
  return new Response(upstream.body, {
    headers: {
      "Content-Type": signed.value.mime,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Disposition": `${isPdf ? "attachment" : "inline"}; filename="proof-${id.slice(0, 8)}.${EXT[signed.value.mime]}"`,
    },
  });
}
