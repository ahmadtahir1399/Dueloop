import { LogOut, Search } from "lucide-react";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { ThemeMenu, ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/ui/wordmark";
import type { TenantSummary } from "@/lib/session";
import { signOut } from "@/app/(staff)/sign-in/actions";
import { MobileNav } from "./mobile-nav";
import { SearchShortcut } from "./search-shortcut";
import type { NavLink } from "@/components/app-nav";
import type { CounterKey } from "@/lib/nav";
import Link from "next/link";

/**
 * App header (§4.2): business switcher (only for > 1 business), search (⌘K / Ctrl K focuses it; it searches the
 * existing invoice list filter, Q5), theme control (◐ popover, and again in the account menu; §3.1.4), account.
 * Search, business switch and sign-out are plain forms that work without JavaScript; the theme needs it (next-themes).
 */
export function ShellHeader({
  email,
  role,
  tenants,
  currentTenant,
  tenantName,
  links,
  counters,
  sending,
}: {
  email: string | null;
  role: string;
  tenants: TenantSummary[];
  currentTenant: string;
  tenantName: string;
  links: NavLink[];
  counters: Partial<Record<CounterKey, number>>;
  sending: React.ReactNode;
}) {
  const initial = (email ?? "?").slice(0, 1).toUpperCase();
  return (
    <header className="sticky top-0 z-(--z-header) border-b border-line bg-canvas">
      <div className="flex h-14 items-center gap-2 gutter md:h-16">
        <MobileNav links={links} counters={counters} sending={sending} />
        <Link href="/overview" className="mr-auto rounded-sm md:hidden" aria-label="Dueloop, go to Overview">
          <Wordmark />
        </Link>
        <div className="hidden min-w-0 items-center gap-3 md:flex">
          <span className="truncate t-body-sm font-semibold text-ink" dir="auto">
            {tenantName}
          </span>
          <TenantSwitcher tenants={tenants} current={currentTenant} />
        </div>
        <form method="get" action="/invoices" role="search" aria-label="Search invoices" className="ml-auto hidden items-center sm:flex">
          <label htmlFor="shell-search" className="sr-only">
            Search invoices or customers
          </label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              id="shell-search"
              name="q"
              type="search"
              maxLength={60}
              placeholder="Search invoices or customers"
              className="h-10 w-56 rounded-sm border border-line-control bg-panel pr-16 pl-9 t-body-sm text-ink outline-none transition-colors-fast placeholder:text-ink-muted hover:border-line-strong focus-visible:border-brand lg:w-72"
            />
            <kbd aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-xs border border-line px-1.5 t-caption text-ink-muted">
              Ctrl K
            </kbd>
          </div>
          <SearchShortcut inputId="shell-search" />
        </form>
        <ThemeMenu />
        <span data-testid="whoami" className="sr-only">
          {email} · <span>{role}</span>
        </span>
        <details className="group relative">
          <summary
            aria-label="Account and theme"
            className="press flex size-11 cursor-pointer list-none items-center justify-center rounded-full [&::-webkit-details-marker]:hidden"
          >
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-brand-soft t-body-sm font-semibold text-brand-soft-ink">
              {initial}
            </span>
          </summary>
          <div className="absolute right-0 z-(--z-dropdown) mt-2 grid w-72 gap-3 rounded-lg border border-line bg-raised p-4 shadow-elev-2">
            <div className="grid gap-0.5">
              <p className="t-body-sm font-semibold break-all text-ink">{email}</p>
              <p className="t-caption text-ink-muted capitalize">{role}</p>
            </div>
            <div className="grid gap-2">
              <p aria-hidden="true" className="t-label">
                Theme
              </p>
              <ThemeToggle />
            </div>
            <form action={signOut}>
              <button type="submit" className="press flex min-h-11 w-full items-center gap-2 rounded-md px-2 t-body-sm font-medium text-ink hover:bg-sunken">
                <LogOut aria-hidden="true" className="size-4" />
                Sign out
              </button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
