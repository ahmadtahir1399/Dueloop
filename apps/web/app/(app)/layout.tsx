import { AppNav } from "@/components/app-nav";
import { Button } from "@/components/ui/button";
import { requireTenant } from "@/lib/session";
import { signOut } from "../login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { tenant, email, role } = await requireTenant();
  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold">{tenant.name}</span>
            <AppNav />
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline">
              {email} · {role}
            </span>
            <form action={signOut}>
              <Button variant="outline" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
