"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ClipboardList,
  FileCheck,
  Inbox,
  LayoutDashboard,
  ListChecks,
  ReceiptText,
  Settings,
  TriangleAlert,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { CountBadge } from "@/components/ui/count-badge";
import { NAV_GROUP_LABEL, navAccessibleName, type CounterKey, type NavGroup, type NavIcon } from "@/lib/nav";
import { cn } from "cn";

export interface NavLink {
  href: string;
  label: string;
  group: NavGroup;
  icon: NavIcon;
  counter?: CounterKey;
}

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  invoices: ReceiptText,
  customers: Users,
  inbox: Inbox,
  approvals: ListChecks,
  tasks: ClipboardList,
  proofs: FileCheck,
  unknown: TriangleAlert,
  import: Upload,
  settings: Settings,
};

/** Role-aware links (the server filters them by the role matrix). Counters are hints, never authority. */
export const COUNTER_POLL_MS = 30_000;

/** Nav counters, refreshed by polling (ADR 0044). A missed update only delays a badge. */
export function useCounters(initial: Partial<Record<CounterKey, number>>) {
  const [counters, setCounters] = useState(initial);
  useEffect(() => setCounters(initial), [initial]);
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
  return counters;
}

/**
 * The sidebar navigation. `variant` "full" shows labels (desktop sidebar and mobile sheet); "rail" shows icons with
 * the label as a tooltip on hover and focus (tablet). The link's accessible name always includes the count.
 */
export function AppNav({
  links,
  counters: initial,
  variant = "responsive",
  onNavigate,
}: {
  links: NavLink[];
  counters: Partial<Record<CounterKey, number>>;
  /** "responsive": rail (icons + tooltip) below 1024 px, full labels above. "full": always labelled (mobile sheet). */
  variant?: "full" | "responsive";
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const counters = useCounters(initial);
  const groups = (["daily", "decisions", "setup"] as const).map((g) => ({ g, items: links.filter((l) => l.group === g) })).filter((x) => x.items.length);
  return (
    <nav aria-label="Main" className="grid gap-5">
      {groups.map(({ g, items }) => (
        <div key={g} className="grid gap-0.5">
          {NAV_GROUP_LABEL[g] ? (
            <p className={cn("t-label px-3 pb-1 text-ink-inverse-muted", variant === "responsive" && "max-lg:sr-only")}>{NAV_GROUP_LABEL[g]}</p>
          ) : null}
          <ul className="grid gap-0.5">
            {items.map((l) => {
              const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
              const n = l.counter ? counters[l.counter] : undefined;
              const Icon = ICONS[l.icon];
              return (
                <li key={l.href} className="group/nav relative">
                  <Link
                    href={l.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-md px-3 t-body-sm font-medium transition-colors-fast",
                      active ? "bg-inverse-raised text-ink-inverse" : "text-ink-inverse-muted hover:bg-inverse-raised hover:text-ink-inverse",
                      variant === "responsive" && "max-lg:justify-center max-lg:px-0",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
                    <span className={cn("flex-1", variant === "responsive" && "max-lg:sr-only")}>{l.label}</span>
                    <CountBadge count={n} className={variant === "responsive" ? "max-lg:hidden" : undefined} />
                    {variant === "responsive" ? <CountBadge count={n} dot className="absolute top-2 right-3 lg:hidden" /> : null}
                    {/* Accessible name = visible label + "N waiting" (§8.1), without an aria-label that hides the text. */}
                    {n ? <span className="sr-only">, {n} waiting</span> : null}
                  </Link>
                  {variant === "responsive" ? (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 left-full z-(--z-dropdown) ml-2 hidden -translate-y-1/2 rounded-sm bg-inverse px-2 py-1 t-caption whitespace-nowrap text-ink-inverse shadow-elev-2 group-focus-within/nav:block group-hover/nav:block lg:!hidden"
                    >
                      {navAccessibleName(l.label, n)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
