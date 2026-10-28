// GET /o/<token>: the opt-out page. Read-only: it asks, it does not record (link scanners must not opt anyone
// out). The button POSTs to /o/<token>/unsubscribe, the URL the List-Unsubscribe header names (RFC 8058).
import { clientIp, softGetLimit } from "@/lib/public/guard";
import { esc, invalidLink, page } from "@/lib/public/html";
import { optOutPage } from "@/lib/public/page-data";
import { EN } from "@/lib/public/strings";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: RouteContext<"/o/[token]">) {
  const { token } = await ctx.params;
  if (!softGetLimit(`o:${clientIp(req.headers) ?? "noip"}`)) return invalidLink();
  const d = await optOutPage(token);
  if (!d) return invalidLink();
  if (new URL(req.url).searchParams.get("done") === "1") {
    return page({ title: d.business, body: `<h1 dir="auto">${esc(d.business)}</h1><p role="status" class="ok">${esc(EN.optOutDone)}</p>` });
  }
  return page({
    title: EN.optOutTitle(d.business),
    body: `<h1 dir="auto">${esc(EN.optOutTitle(d.business))}</h1><p>${esc(EN.optOutBody)}</p><form method="post" action="/o/${esc(token)}/unsubscribe"><button type="submit">${esc(EN.optOutButton)}</button></form>`,
  });
}
