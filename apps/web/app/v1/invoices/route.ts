// POST /v1/invoices (ADR 0048, issue O). Node runtime. Order: body cap before parsing -> API key (one 401 for
// every failure) -> scope -> per-key rate limit (fail closed) -> schema -> Idempotency-Key -> the CSV import's
// validateFile + stageImport + commit_import_batch (all-or-nothing unless options.skip_invalid). One JSON error
// shape, no stack traces. No other method or route exists under /v1.
import { createHash, randomInt } from "node:crypto";
import { commitImport, stageImport, validateFile } from "@dueloop/ingest";
import { API_MAPPING, API_MAX_BODY_BYTES, apiError, requestSchema, toCsv } from "@/lib/api/invoices";
import { clientIp, hit, LIMITS, readCapped } from "@/lib/public/guard";
import { claimIdempotency, ingestClient, releaseIdempotency, storeIdempotency, verifyApiKey } from "@/lib/trusted/api";

export const runtime = "nodejs";

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });

export async function POST(req: Request) {
  const raw = await readCapped(req, API_MAX_BODY_BYTES);
  if (!raw) return json(413, apiError("payload_too_large", `the body is larger than ${API_MAX_BODY_BYTES} bytes`));

  const ip = clientIp(req.headers);
  if (ip && (await hit(`api:ip:${ip}`, { window: 60, max: 120 })) !== "ok") return json(429, apiError("rate_limited", "too many requests"), { "Retry-After": "60" });
  const caller = await verifyApiKey(req.headers.get("authorization"));
  if (!caller) return json(401, apiError("unauthorized", "a valid API key is required"), { "WWW-Authenticate": "Bearer" });
  if (!caller.scopes.includes("invoices:write")) return json(403, apiError("forbidden", "this key may not write invoices"));
  const limited = await hit(`api:key:${caller.keyId}`, LIMITS.apiPerKey);
  if (limited === "unavailable") return json(503, apiError("unavailable", "try again later"), { "Retry-After": "30" });
  if (limited === "limited") return json(429, apiError("rate_limited", "too many requests for this key"), { "Retry-After": String(LIMITS.apiPerKey.window) });

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, apiError("unsupported_media_type", "send application/json"));
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    return json(400, apiError("invalid_json", "the body is not valid UTF-8 JSON"));
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return json(422, apiError("invalid_request", "the request does not match the schema", parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message }))));
  }

  const idemKey = req.headers.get("idempotency-key");
  if (idemKey !== null && !/^[\x21-\x7e]{1,200}$/.test(idemKey)) return json(400, apiError("invalid_idempotency_key", "1-200 printable ASCII characters"));
  const requestHash = createHash("sha256").update(raw).digest("hex");
  if (idemKey) {
    const c = await claimIdempotency(caller.tenantId, idemKey, requestHash);
    if (c.kind === "replay") return json(c.status, c.response, { "Idempotent-Replayed": "true" });
    if (c.kind === "conflict") return json(422, apiError("idempotency_key_reused", "this Idempotency-Key was used with a different body"));
    if (c.kind === "in_progress") return json(409, apiError("in_progress", "a request with this Idempotency-Key is still running"));
  }

  const finish = async (status: number, payload: unknown) => {
    if (idemKey) await storeIdempotency(caller.tenantId, idemKey, status, payload);
    return json(status, payload);
  };
  try {
    const csv = toCsv(parsed.data);
    if (!csv.ok) return await finish(422, apiError("invalid_invoice", csv.message, { index: csv.index }));
    const bytes = new TextEncoder().encode(csv.csv);
    const options = {
      delimiter: "," as const,
      decimal: "." as const,
      dateFormat: "YMD" as const,
      defaultCountry: parsed.data.options.default_country,
      defaultCurrency: caller.currency,
      timezone: caller.timezone,
    };
    const validation = validateFile(bytes, API_MAPPING, options, randomInt);
    if (validation.summary.errors.length) return await finish(422, apiError("invalid_batch", "the batch could not be read", validation.summary.errors.map((e) => e.message)));
    const rowErrors = validation.rows
      .filter((r) => r.outcome.kind === "error")
      .map((r) => ({ index: r.line - 2, errors: r.outcome.kind === "error" ? r.outcome.errors.map((e) => ({ code: e.code, message: e.message })) : [] }));
    if (rowErrors.length && !parsed.data.options.skip_invalid) {
      return await finish(422, apiError("invalid_invoices", "some invoices are invalid; nothing was imported (set options.skip_invalid to import the rest)", rowErrors.slice(0, 100)));
    }
    const client = ingestClient();
    const staged = await stageImport(client, { tenantId: caller.tenantId, uploadedBy: null, fileName: `api-${caller.keyId.slice(0, 8)}.json`, bytes, mapping: API_MAPPING, options, validation });
    if (!staged.ok) return await finish(500, apiError("stage_failed", "the batch could not be staged"));
    const committed = await commitImport(client, staged.batchId, { skipInvalidRows: parsed.data.options.skip_invalid });
    if (!committed.ok) return await finish(409, apiError("commit_refused", "the batch was not committed", { reason: committed.code ?? "refused" }));
    return await finish(201, { batch_id: staged.batchId, counts: committed.counts, skipped_invalid: rowErrors });
  } catch {
    if (idemKey) await releaseIdempotency(caller.tenantId, idemKey);
    return json(500, apiError("internal", "the request failed; nothing was committed"));
  }
}
