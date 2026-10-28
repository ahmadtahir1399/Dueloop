// Request guards for the public surface (rules 35, 36, 39; issues B and P).
import "server-only";
import { trustedPool } from "@/lib/trusted/db";

/** Body caps, checked against Content-Length BEFORE reading and enforced again while reading. */
export const FORM_MAX_BYTES = 4 * 1024;
export const PROOF_MAX_BYTES = 10 * 1024 * 1024 + 64 * 1024; // the proof limit plus multipart overhead

/** Limits per fixed window (seconds, hits). Shared across instances through the Postgres counter (ADR 0047). */
export const LIMITS = {
  actionPerToken: { window: 3600, max: 20 },
  actionPerIp: { window: 3600, max: 60 },
  proofPerToken: { window: 86_400, max: 5 },
  apiPerKey: { window: 60, max: 60 },
  signInPerIp: { window: 900, max: 20 },
} as const;

/**
 * The client IP, only when the deployment says how many trusted proxies append to X-Forwarded-For
 * (TRUST_PROXY_HOPS, default 0 = do not trust the header at all). The address is taken that many hops from the
 * RIGHT, which the proxy wrote; anything to its left is client-controlled.
 */
export function clientIp(h: Headers): string | null {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? "0");
  if (!Number.isSafeInteger(hops) || hops < 1) return null;
  const parts = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts[parts.length - hops];
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

/** One POST hit against a bucket. Fail-CLOSED: if the store cannot be reached, the action is refused. */
export async function hit(bucket: string, limit: { window: number; max: number }, now = new Date()): Promise<"ok" | "limited" | "unavailable"> {
  try {
    const r = await trustedPool().query<{ ok: boolean }>("select private.rate_limit_hit($1, $2, $3, $4) as ok", [bucket.slice(0, 200), limit.window, limit.max, now]);
    return r.rows[0]?.ok ? "ok" : "limited";
  } catch {
    return "unavailable";
  }
}

/**
 * Same-origin check for form POSTs (CSRF). Our public pages are served with Referrer-Policy: no-referrer, and for
 * such pages browsers send `Origin: null` on form POSTs (Fetch spec, "serializing a request origin"). So the
 * primary signal is Fetch Metadata: `Sec-Fetch-Site: same-origin`. An explicit Origin equal to PUBLIC_APP_URL is
 * also accepted. Anything else (cross-site, missing headers) is refused. Server Actions are not used here because
 * they let a request without Origin through.
 */
export function sameOrigin(h: Headers): boolean {
  const site = h.get("sec-fetch-site");
  if (site === "cross-site" || site === "same-site") return false;
  if (site === "same-origin") return true;
  const origin = h.get("origin");
  const base = process.env.PUBLIC_APP_URL;
  if (!origin || origin === "null" || !base) return false;
  try {
    return new URL(origin).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/** Reads at most `max` bytes of the body; null when it is larger (or Content-Length already says so). */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const len = Number(req.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(len) && len > max) return null;
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** In-memory GET throttle per instance. GETs must write nothing (rule 35), so they cannot use the DB counter. */
const getHits = new Map<string, { at: number; n: number }>();
export function softGetLimit(key: string, max = 120, windowMs = 60_000, now = Date.now()): boolean {
  const e = getHits.get(key);
  if (!e || now - e.at > windowMs) {
    getHits.set(key, { at: now, n: 1 });
    if (getHits.size > 10_000) getHits.clear();
    return true;
  }
  e.n++;
  return e.n <= max;
}
