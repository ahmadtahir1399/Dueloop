"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { CounterKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

export interface NavLink {
  href: string;
  label: string;
  counter?: CounterKey;
}

/** Role-aware links (the server filters them by the role matrix). Counters are hints, never authority. */
export const COUNTER_POLL_MS = 30_000;

export function AppNav({ links, counters: initial }: { links: NavLink[]; counters: Partial<Record<CounterKey, number>> }) {
  const pathname = usePathname();
  const [counters, setCounters] = useState(initial);
  useEffect(() => setCounters(initial), [initial]);
  // Polling (not Realtime): a missed update only delays a badge; correctness never depends on it.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/counters", { cache: "no-store" });
        if (r.ok && !stopped) setCounters((await r.json()) as Partial<Record<CounterKey, number>>);
      } catch {
        // offline or signed out: keep the last numbers
      }
    };
    const id = setInterval(() => void tick(), COUNTER_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);
  return (
    <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        const n = l.counter ? counters[l.counter] : undefined;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {l.label}
            {n ? (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground" aria-label={`${n} waiting`}>
                {n}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
