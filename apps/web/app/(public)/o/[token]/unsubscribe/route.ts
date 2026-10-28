// Opt-out POST (issue F). Two callers:
// 1. our own confirm form (same-origin POST from /o/<token>) -> 303 back to the page with a neutral confirmation;
// 2. a mail provider's RFC 8058 one-click POST: no cookies, no Origin, body exactly "List-Unsubscribe=One-Click"
//    (multipart or urlencoded) -> 200, no redirect (RFC 8058 section 3.2 forbids a redirect).
// Both go through the same record_opt_out effect as a STOP reply. GET here only points to the page.
import { optOut } from "@/lib/public/actions";
import { clientIp, FORM_MAX_BYTES, hit, LIMITS, readCapped, sameOrigin } from "@/lib/public/guard";
import { hashToken, linkFor } from "@/lib/public/page-data";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(_req: Request, ctx: RouteContext<"/o/[token]/unsubscribe">) {
  const { token } = await ctx.params;
  return new Response(null, { status: 303, headers: { Location: `/o/${token}`, ...NO_STORE } });
}

export async function POST(req: Request, ctx: RouteContext<"/o/[token]/unsubscribe">) {
  const { token } = await ctx.params;
  const raw = await readCapped(req, FORM_MAX_BYTES);
  if (!raw) return new Response("Payload too large", { status: 413, headers: NO_STORE });
  const text = new TextDecoder().decode(raw);
  const oneClick = /(^|[\r\n&])List-Unsubscribe=One-Click($|[\r\n&])/.test(text) || /name="List-Unsubscribe"\r?\n\r?\nOne-Click/.test(text);
  const ownForm = sameOrigin(req.headers);
  if (!oneClick && !ownForm) return new Response("Forbidden", { status: 403, headers: NO_STORE });
  const link = await linkFor(token, "opt_out");
  if (!link) return new Response("This link is no longer valid", { status: 404, headers: NO_STORE });
  const ip = clientIp(req.headers);
  for (const [bucket, limit] of [[`optout:tok:${hashToken(token)}`, LIMITS.actionPerToken], ...(ip ? [[`act:ip:${ip}`, LIMITS.actionPerIp] as const] : [])] as const) {
    const r = await hit(bucket, limit);
    if (r !== "ok") return new Response(r === "limited" ? "Too many requests" : "Unavailable", { status: r === "limited" ? 429 : 503, headers: NO_STORE });
  }
  try {
    await optOut(link);
  } catch {
    return new Response("Something went wrong. Nothing was changed.", { status: 500, headers: NO_STORE });
  }
  if (oneClick && !ownForm) return new Response("Unsubscribed", { status: 200, headers: NO_STORE });
  return new Response(null, { status: 303, headers: { Location: `/o/${token}?done=1`, ...NO_STORE } });
}
