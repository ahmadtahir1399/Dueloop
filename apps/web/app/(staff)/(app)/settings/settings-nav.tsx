"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

export function SettingsNav({ sections }: { sections: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings sections" className="-mx-(--gutter) overflow-x-auto px-(--gutter) lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 border-b border-line lg:sticky lg:top-24 lg:grid lg:border-0">
        {sections.map((s) => {
          const active = s.href === "/settings" ? pathname === "/settings" : pathname.startsWith(s.href);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center px-3 t-body-sm font-medium whitespace-nowrap transition-colors-fast",
                  "border-b-2 lg:rounded-md lg:border-b-0",
                  active ? "border-brand text-ink lg:bg-brand-soft lg:text-brand-soft-ink" : "border-transparent text-ink-muted hover:text-ink lg:hover:bg-sunken",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
