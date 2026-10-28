// Every pay-page action is a POST here (rules 35, 39; issues B, C, E, P). Order of checks: same-origin form POST,
// body cap BEFORE parsing, valid 'pay' token (uniform 404 otherwise), shared rate limits per token and per IP
// (fail-closed), then the pipeline. Answers are 303 redirects back to the page (no token in any other URL; the
// Referer is suppressed by Referrer-Policy: no-referrer). A redirect to hosted checkout carries no token.
import { copyRequest, payNow, promiseFromPage, uploadProof } from "@/lib/public/actions";
import { clientIp, FORM_MAX_BYTES, hit, LIMITS, PROOF_MAX_BYTES, readCapped, sameOrigin } from "@/lib/public/guard";
import { hashToken, linkFor } from "@/lib/public/page-data";

export const runtime = "nodejs";

function back(token: string, done: string) {
  return new Response(null, { status: 303, headers: { Location: `/p/${token}?done=${done}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function POST(req: Request, ctx: RouteContext<"/p/[token]/act">) {
  const { token } = await ctx.params;
  if (!sameOrigin(req.headers)) return new Response("Forbidden", { status: 403 });
  const multipart = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  const raw = await readCapped(req, multipart ? PROOF_MAX_BYTES : FORM_MAX_BYTES);
  if (!raw) return new Response("Payload too large", { status: 413 });
  const link = await linkFor(token, "pay");
  if (!link) return new Response("This link is no longer valid", { status: 404, headers: { "Cache-Control": "no-store" } });

  const ip = clientIp(req.headers);
  for (const [bucket, limit] of [
    [`act:tok:${hashToken(token)}`, LIMITS.actionPerToken],
    ...(ip ? [[`act:ip:${ip}`, LIMITS.actionPerIp] as const] : []),
  ] as const) {
    const r = await hit(bucket, limit);
    if (r === "unavailable") return back(token, "failed"); // fail closed
    if (r === "limited") return back(token, "limited");
  }

  let form: FormData;
  try {
    form = await new Request(req.url, { method: "POST", headers: { "content-type": req.headers.get("content-type") ?? "" }, body: new Blob([new Uint8Array(raw)]) }).formData();
  } catch {
    return back(token, "failed");
  }
  const action = form.get("action");
  try {
    if (action === "pay") {
      const r = await payNow(link);
      if (r.result === "ok" && r.url) return new Response(null, { status: 303, headers: { Location: r.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
      return back(token, r.result === "closed" ? "failed" : "gateway");
    }
    if (action === "promise") {
      const r = await promiseFromPage(link, String(form.get("date") ?? ""));
      return back(token, r === "ok" ? "promise" : r === "review" ? "promise_review" : "failed");
    }
    if (action === "copy") {
      const r = await copyRequest(link);
      return back(token, r === "ok" ? "copy" : "failed");
    }
    if (action === "proof") {
      const p = await hit(`proof:tok:${hashToken(token)}`, LIMITS.proofPerToken);
      if (p !== "ok") return back(token, p === "limited" ? "limited" : "failed");
      const f = form.get("file");
      if (!(f instanceof File) || f.size === 0) return back(token, "proof_refused");
      const r = await uploadProof(link, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
      return back(token, r === "ok" ? "proof" : "proof_refused");
    }
  } catch {
    return back(token, "failed");
  }
  return back(token, "failed");
}
