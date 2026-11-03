// The polite announcement after a filter change (§4.10 rule 8). The lists load one page and no total (C-14), so the
// count is exact only when everything fits on this page; otherwise it says so (CONFLICTS C-52). No new query.
export function countText(shown: number, more: boolean, noun: string): string {
  const n = (k: number) => `${k} ${noun}${k === 1 ? "" : "s"}`;
  if (shown === 0) return `No ${noun}s match`;
  return more ? `Showing the first ${n(shown)}; more on the next page` : n(shown);
}
