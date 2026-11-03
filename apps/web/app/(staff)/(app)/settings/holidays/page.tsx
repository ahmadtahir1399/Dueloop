import { CalendarOff } from "lucide-react";
import { can } from "@dueloop/authz";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ActionForm } from "@/components/action-form";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/session";
import { formatDate } from "@/lib/time";
import { holidayAction } from "../admin-actions";
import { HolidayForm } from "../forms";

export default async function HolidaysPage() {
  const ctx = await requirePermission("settings.view");
  const { data, error } = await ctx.supabase.from("holidays").select("on_date, label").eq("tenant_id", ctx.tenant.id).order("on_date");
  if (error) throw new Error("could not load holidays");
  const edit = can(ctx.role, "holidays.edit");
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Holidays" description={`Dates in ${ctx.tenant.timezone}. Nothing is sent on these days.`} />
      {(data ?? []).length === 0 ? (
        <EmptyState title="No holidays" icon={CalendarOff}>
          Add dates when no reminders should go out.
        </EmptyState>
      ) : null}
      <ul className="card-edge divide-y divide-line rounded-xl border border-line bg-panel t-body-sm empty:hidden" data-testid="holiday-list">
        {(data ?? []).map((h) => (
          <li key={h.on_date} className="flex items-center justify-between gap-3 px-4 py-2">
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
      {edit ? <HolidayForm /> : null}
    </div>
  );
}
