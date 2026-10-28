import { can } from "@dueloop/authz";
import { ActionForm } from "@/components/action-form";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/session";
import { formatDate } from "@/lib/time";
import { holidayAction } from "../admin-actions";

export default async function HolidaysPage() {
  const ctx = await requirePermission("settings.view");
  const { data, error } = await ctx.supabase.from("holidays").select("on_date, label").eq("tenant_id", ctx.tenant.id).order("on_date");
  if (error) throw new Error("could not load holidays");
  const edit = can(ctx.role, "holidays.edit");
  return (
    <div className="grid max-w-xl gap-4">
      <h1 className="text-xl font-semibold">Holidays</h1>
      <p className="text-sm text-muted-foreground">Dates in {ctx.tenant.timezone}. Nothing is sent on these days.</p>
      <ul className="grid gap-1 text-sm" data-testid="holiday-list">
        {(data ?? []).map((h) => (
          <li key={h.on_date} className="flex items-center gap-3">
            <span>
              {formatDate(h.on_date)} <UntrustedText text={h.label} />
            </span>
            {edit ? (
              <ActionForm action={holidayAction} label={`Remove ${h.on_date}`} className="inline">
                <input type="hidden" name="date" value={h.on_date} />
                <Button type="submit" name="op" value="delete" size="sm" variant="ghost">
                  Remove
                </Button>
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>
      {edit ? (
        <ActionForm action={holidayAction} label="Add a holiday" className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            Date
            <Input name="date" type="date" required />
          </label>
          <label className="grid gap-1 text-sm">
            Label
            <Input name="label" maxLength={80} />
          </label>
          <Button type="submit" name="op" value="add">
            Add
          </Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
