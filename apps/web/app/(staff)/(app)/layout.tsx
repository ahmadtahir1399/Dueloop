import Link from "next/link";
import { can } from "@dueloop/authz";
import { AppNav } from "@/components/app-nav";
import { PausedBanner } from "@/components/paused-banner";
import { ShellHeader } from "@/components/shell/shell-header";
import { SendingStatus } from "@/components/shell/sending-status";
import { Wordmark } from "@/components/ui/wordmark";
import { navFor } from "@/lib/nav";
import { requireTenant } from "@/lib/session";
import { loadCounters, loadGlobalPause } from "@/lib/shell";

// App shell (redesign §4.2): inverse sidebar (264 px desktop, 72 px rail on tablet, a sheet on mobile), header,
// paused banner, content max 1280 px. Role-hidden items are not rendered at all (C8); the database decides.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireTenant();
  const [counters, globalPaused] = await Promise.all([loadCounters(ctx), loadGlobalPause(ctx)]);
  const links = navFor(ctx.role).map(({ href, label, group, icon, counter }) => (counter ? { href, label, group, icon, counter } : { href, label, group, icon }));
  const sending = <SendingStatus paused={ctx.tenant.outboundPaused || globalPaused} canToggle={can(ctx.role, "killswitch.toggle")} quietStart={ctx.tenant.quietStartHour} quietEnd={ctx.tenant.quietEndHour} />;
  return (
    <div className="min-h-svh md:grid md:grid-cols-[var(--rail-width)_1fr] lg:grid-cols-[var(--sidebar-width)_1fr]">
      <a
        href="#main"
        className="sr-only z-(--z-skip-link) rounded-md bg-panel px-4 py-3 t-body-sm font-semibold text-ink shadow-elev-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside className="on-inverse sticky top-0 hidden h-svh flex-col gap-6 overflow-y-auto bg-inverse px-3 py-4 md:flex">
        <Link href="/overview" aria-label="Dueloop, go to Overview" className="flex min-h-11 items-center rounded-md px-2 max-lg:justify-center">
          <Wordmark inverse compact="below-lg" />
        </Link>
        <AppNav links={links} counters={counters} />
        <div className="mt-auto max-lg:hidden">{sending}</div>
      </aside>
      <div className="min-w-0">
        <ShellHeader
          email={ctx.email}
          role={ctx.role}
          tenants={ctx.tenants}
          currentTenant={ctx.tenant.id}
          tenantName={ctx.tenant.name}
          links={links}
          counters={counters}
          sending={sending}
        />
        <PausedBanner tenantPaused={ctx.tenant.outboundPaused} globalPaused={globalPaused} canToggle={can(ctx.role, "killswitch.toggle")} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-(--content-max) gutter py-6 outline-none md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
