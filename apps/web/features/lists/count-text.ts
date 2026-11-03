// The polite announcement after a filter change (§4.10 rule 8). The lists load one page and no total (C-14), so the
// count is exact only when everything fits on this page; otherwise it says so (CONFLICTS C-52). No new query.
// `filtered: false` (a default tab, no filter set) drops "match"; `paged: false` (a capped list with no next page,
// e.g. tasks and proofs at their 200-row limit) drops the "next page" promise.
export function countText(shown: number, more: boolean, noun: string, opts: { filtered?: boolean; paged?: boolean } = {}): string {
  const { filtered = true, paged = true } = opts;
  const n = (k: number) => `${k} ${noun}${k === 1 ? "" : "s"}`;
  if (shown === 0) return filtered ? `No ${noun}s match` : `No ${noun}s`;
  if (!more) return n(shown);
  return paged ? `Showing the first ${n(shown)}; more on the next page` : `Showing the first ${n(shown)}`;
}
