import { AppNav } from "@/components/app-nav";
import { PausedBanner } from "@/components/paused-banner";
import { TenantSwitcher } from "@/components/tenant-switcher";
import { Button } from "@/components/ui/button";
import { navFor } from "@/lib/nav";
import { requireTenant } from "@/lib/session";
import { loadCounters, loadGlobalPause } from "@/lib/shell";
import { signOut } from "../login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireTenant();
  const [counters, globalPaused] = await Promise.all([loadCounters(ctx), loadGlobalPause(ctx)]);
  const links = navFor(ctx.role).map(({ href, label, counter }) => (counter ? { href, label, counter } : { href, label }));
  return (
    <div className="min-h-svh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold" dir="auto">
              {ctx.tenant.name}
            </span>
            <AppNav links={links} counters={counters} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <TenantSwitcher tenants={ctx.tenants} current={ctx.tenant.id} />
            <span className="hidden sm:inline" data-testid="whoami">
              {ctx.email} · {ctx.role}
            </span>
            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <PausedBanner tenantPaused={ctx.tenant.outboundPaused} globalPaused={globalPaused} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
