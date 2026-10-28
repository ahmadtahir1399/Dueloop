// GET /p/<token>: the pay page. READ-ONLY (rule 35): link scanners and previews may fetch it any number of times;
// nothing is written, no session is created, no provider call is made. Forms POST to /p/<token>/act.
import { DateTime } from "luxon";
import { formatMinor, minorIsPositive } from "@/lib/money";
import { clientIp, softGetLimit } from "@/lib/public/guard";
import { esc, invalidLink, page } from "@/lib/public/html";
import { payPage } from "@/lib/public/page-data";
import { EN } from "@/lib/public/strings";
import { formatDate } from "@/lib/time";

export const runtime = "nodejs";

const DONE: Record<string, { text: string; ok: boolean }> = {
  promise: { text: EN.promiseThanks, ok: true },
  promise_review: { text: EN.promiseReview, ok: true },
  proof: { text: EN.proofThanks, ok: true },
  proof_refused: { text: EN.proofRefused, ok: false },
  copy: { text: EN.copyThanks, ok: true },
  gateway: { text: EN.gatewayDown, ok: false },
  limited: { text: EN.tooMany, ok: false },
  failed: { text: EN.failed, ok: false },
};

export async function GET(req: Request, ctx: RouteContext<"/p/[token]">) {
  const { token } = await ctx.params;
  if (!softGetLimit(`p:${clientIp(req.headers) ?? "noip"}`)) return invalidLink();
  const d = await payPage(token);
  if (!d) return invalidLink();
  const done = DONE[new URL(req.url).searchParams.get("done") ?? ""];
  const nonce = req.headers.get("x-nonce");
  const action = `/p/${esc(token)}/act`;
  const head = `<h1 dir="auto">${esc(d.business)}</h1>`;

  if (d.status === "paid") return page({ title: d.business, body: `${head}<p class="ok">${esc(EN.paid)}</p>` });
  if (d.status === "cancelled" || d.status === "written_off") return page({ title: d.business, body: `${head}<p>${esc(EN.closed)}</p>` });

  const today = DateTime.now().setZone(d.timezone);
  const facts = `<dl aria-label="${esc(EN.payTitle)}">
<dt>${esc(EN.payTitle)}</dt><dd dir="auto">${esc(d.invoiceNumber)}</dd>
<dt>${esc(EN.dueOn)}</dt><dd>${esc(formatDate(d.dueOn))}</dd>
${minorIsPositive(d.amountPaid) ? `<dt>${esc(EN.paidSoFar)}</dt><dd>${esc(formatMinor(d.amountPaid, d.currency))}</dd>` : ""}
<dt>${esc(EN.balance)}</dt><dd class="amount" data-testid="pay-balance">${esc(formatMinor(d.balance, d.currency))}</dd>
</dl>`;
  const status = done ? `<p role="status" class="${done.ok ? "ok" : "note"}">${esc(done.text)}</p>` : "";

  if (d.status === "disputed") return page({ title: d.business, body: `${head}${status}${facts}<p class="note">${esc(EN.disputed)}</p>` });

  const pay =
    d.hasGateway && minorIsPositive(d.balance)
      ? `<section aria-labelledby="pay-h"><h2 id="pay-h">${esc(EN.payNow)}</h2><form method="post" action="${action}"><input type="hidden" name="action" value="pay"><p class="muted">${esc(EN.payNowHelp)}</p><button type="submit">${esc(EN.payNow)}</button></form></section>`
      : "";
  const bank = `<section aria-labelledby="bank-h"><h2 id="bank-h">${esc(EN.bankTitle)}</h2>${d.bankInstructions ? `<pre dir="auto">${esc(d.bankInstructions)}</pre>` : ""}<p>${esc(EN.bankQuote)} <span class="ref" id="ref-code">${esc(d.referenceCode)}</span></p></section>`;
  const promise = `<section aria-labelledby="promise-h"><h2 id="promise-h">${esc(EN.promiseTitle)}</h2><form method="post" action="${action}"><input type="hidden" name="action" value="promise"><label for="promise-date">${esc(EN.promiseLabel)}</label><input id="promise-date" name="date" type="date" required min="${esc(today.toISODate())}" max="${esc(today.plus({ days: 90 }).toISODate())}"><button type="submit">${esc(EN.promiseSend)}</button></form></section>`;
  const proof = `<section aria-labelledby="proof-h"><h2 id="proof-h">${esc(EN.proofTitle)}</h2><form method="post" action="${action}" enctype="multipart/form-data"><input type="hidden" name="action" value="proof"><label for="proof-file">${esc(EN.proofLabel)}</label><input id="proof-file" name="file" type="file" required accept="image/jpeg,image/png,image/webp,application/pdf"><button type="submit">${esc(EN.proofSend)}</button></form></section>`;
  const copy = `<section aria-labelledby="copy-h"><h2 id="copy-h">${esc(EN.copyTitle)}</h2><form method="post" action="${action}"><input type="hidden" name="action" value="copy"><button type="submit" class="secondary">${esc(EN.copySend)}</button></form></section>`;
  return page({ title: `${d.business}: ${d.invoiceNumber}`, nonce, script: true, body: `${head}${status}${facts}${pay}${bank}${promise}${proof}${copy}` });
}
