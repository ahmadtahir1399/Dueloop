"use client";

// Auto-applied list filters (redesign §4.10, v1.2). The URL is the source of truth: the server page parses it and
// hands the current query string down; a filter change rewrites it with router.replace(url, { scroll: false })
// (Next 16 docs, use-router.md: replace adds no history entry, scroll:false keeps the scroll position) inside a
// transition, so the old rows stay on screen while the server renders the new ones. During that transition the
// controls already show the new value (React 19 useOptimistic), and fall back to the URL if navigation fails.
// Any filter change drops the cursor (rule 2). "all" or "" removes a param (rule 11).
// The query comes from the server rather than useSearchParams(), so no Suspense boundary is needed (C-51).
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useMemo, useOptimistic, useRef, useTransition } from "react";
import { nextQuery, withQuery, type FilterPatch } from "./query";

export type { FilterPatch };

export function useListFilters(query: string) {
  const router = useRouter();
  const pathname = usePathname();
  const [shown, setShown] = useOptimistic(query);
  const [isPending, startTransition] = useTransition();
  const params = useMemo(() => new URLSearchParams(shown), [shown]);
  // The newest query, so a call made later than its render (the debounced search) builds on the latest filters
  // instead of the ones it captured, and two changes in one tick both survive (8c review).
  const latest = useRef(shown);
  useLayoutEffect(() => {
    latest.current = shown;
  }, [shown]);
  const setFilters = useCallback(
    (patch: FilterPatch) => {
      const base = latest.current;
      const next = nextQuery(base, patch);
      if (next === base) return;
      latest.current = next;
      startTransition(() => {
        setShown(next);
        router.replace(withQuery(pathname, next), { scroll: false });
      });
    },
    [pathname, router, setShown],
  );
  const setFilter = useCallback((key: string, value: string | undefined | null) => setFilters({ [key]: value }), [setFilters]);
  return { params, pathname, setFilter, setFilters, isPending };
}
