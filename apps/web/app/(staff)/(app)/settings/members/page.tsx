import { can } from "@dueloop/authz";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/session";
import { memberAction } from "../admin-actions";
import { InviteForm } from "../forms";
import { PageHeader } from "@/components/ui/page-header";
import { ChoiceSelect } from "@/components/ui/choice-select";

export default async function MembersPage() {
  const ctx = await requirePermission("members.view");
  const { data, error } = await ctx.supabase.rpc("list_members", { p_tenant: ctx.tenant.id });
  if (error) throw new Error("could not load members");
  const manage = can(ctx.role, "members.manage");
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title="Members" description="A business always keeps at least one owner; the last owner cannot be removed or changed." />
      <ul className="grid gap-3" data-testid="member-list">
        {(data ?? []).map((m) => (
          <li key={m.user_id} className="card-edge grid gap-2 rounded-xl border border-line bg-panel p-4 t-body-sm" data-member={m.email ?? m.user_id}>
            <span>
              {m.email} · {m.role}
            </span>
            {manage ? (
              <div className="flex flex-wrap gap-2">
                <ActionForm action={memberAction} label={`Change role of ${m.email}`} className="flex items-end gap-2">
                  <input type="hidden" name="user" value={m.user_id} />
                  <input type="hidden" name="op" value="role" />
                  <ChoiceSelect
                    name="role"
                    defaultValue={m.role}
                    ariaLabel={`Role of ${m.email}`}
                    className="w-40"
                    options={[
                      { value: "owner", label: "owner" },
                      { value: "accountant", label: "accountant" },
                      { value: "collector", label: "collector" },
                    ]}
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Change role
                  </Button>
                </ActionForm>
                <ActionForm action={memberAction} label={`Remove ${m.email}`} className="flex items-end gap-2">
                  <input type="hidden" name="user" value={m.user_id} />
                  <input type="hidden" name="op" value="remove" />
                  <Button type="submit" size="sm" variant="ghost">
                    Remove
                  </Button>
                </ActionForm>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {manage ? (
        <section aria-label="Invite member" className="card-edge rounded-xl border border-line bg-panel p-5">
          <InviteForm />
        </section>
      ) : null}
    </div>
  );
}
