import { switchTenant } from "@/app/(staff)/(app)/_shell/actions";
import { Button } from "@/components/ui/button";
import type { TenantSummary } from "@/lib/session";

/** A plain form (works without JavaScript). Shown only for users in more than one tenant. */
export function TenantSwitcher({ tenants, current }: { tenants: TenantSummary[]; current: string }) {
  if (tenants.length < 2) return null;
  return (
    <form action={switchTenant} className="flex items-center gap-2">
      <label htmlFor="tenant-switch" className="sr-only">
        Business
      </label>
      <select
        id="tenant-switch"
        name="tenant"
        defaultValue={current}
        className="h-8 rounded-md border bg-background px-2 text-sm"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.role})
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline">
        Switch
      </Button>
    </form>
  );
}
