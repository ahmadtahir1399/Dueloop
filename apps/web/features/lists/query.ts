// Pure helpers for list URLs (§4.10). Server-safe and unit-tested (test/list-params.test.ts).
import { ALL, CURSOR_KEYS } from "../../domain/list-params";

/** The page's search params as a query string, for <ListScope query>. */
export function queryOf(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") q.set(k, v);
    else if (Array.isArray(v)) for (const x of v) q.append(k, x);
  }
  return q.toString();
}

export type FilterPatch = Record<string, string | undefined | null>;

/** Next URL for a patch, as a pure function (unit-tested). */
export function nextQuery(current: string, patch: FilterPatch): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === "" || v === ALL) next.delete(k);
    else next.set(k, v);
  }
  if (!Object.keys(patch).some((k) => (CURSOR_KEYS as readonly string[]).includes(k))) for (const k of CURSOR_KEYS) next.delete(k);
  return next.toString();
}

export const withQuery = (pathname: string, query: string) => (query ? `${pathname}?${query}` : pathname);
