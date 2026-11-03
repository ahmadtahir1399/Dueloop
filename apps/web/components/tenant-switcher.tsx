import { switchTenant } from "@/app/(staff)/(app)/_shell/actions";
import { Button } from "@/components/ui/button";
import type { TenantSummary } from "@/lib/session";
import { ChoiceSelect } from "@/components/ui/choice-select";

/** A plain form (works without JavaScript). Shown only for users in more than one tenant (Q4). */
export function TenantSwitcher({ tenants, current }: { tenants: TenantSummary[]; current: string }) {
  if (tenants.length < 2) return null;
  return (
    <form action={switchTenant} className="flex items-center gap-2">
      <label htmlFor="tenant-switch" className="sr-only">
        Business
      </label>
      <ChoiceSelect id="tenant-switch" name="tenant" defaultValue={current} size="sm" className="max-w-56" options={tenants.map((t) => ({ value: t.id, label: `${t.name} (${t.role})` }))} />
      <Button type="submit" size="sm" variant="outline">
        Switch
      </Button>
    </form>
  );
}
