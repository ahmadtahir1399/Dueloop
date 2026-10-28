import { can } from "@dueloop/authz";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/session";
import { memberAction } from "../admin-actions";

export default async function MembersPage() {
  const ctx = await requirePermission("members.view");
  const { data, error } = await ctx.supabase.rpc("list_members", { p_tenant: ctx.tenant.id });
  if (error) throw new Error("could not load members");
  const manage = can(ctx.role, "members.manage");
  return (
    <div className="grid max-w-2xl gap-4">
      <h1 className="text-xl font-semibold">Members</h1>
      <p className="text-sm text-muted-foreground">A business always keeps at least one owner; the last owner cannot be removed or changed.</p>
      <ul className="grid gap-3" data-testid="member-list">
        {(data ?? []).map((m) => (
          <li key={m.user_id} className="grid gap-1 rounded-md border p-3 text-sm" data-member={m.email ?? m.user_id}>
            <span>
              {m.email} · {m.role}
            </span>
            {manage ? (
              <div className="flex flex-wrap gap-2">
                <ActionForm action={memberAction} label={`Change role of ${m.email}`} className="flex items-end gap-2">
                  <input type="hidden" name="user" value={m.user_id} />
                  <input type="hidden" name="op" value="role" />
                  <select name="role" defaultValue={m.role} aria-label={`Role of ${m.email}`} className="h-8 rounded-md border bg-background px-2">
                    <option value="owner">owner</option>
                    <option value="accountant">accountant</option>
                    <option value="collector">collector</option>
                  </select>
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
        <ActionForm action={memberAction} label="Invite a member" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="op" value="invite" />
          <label className="grid gap-1 text-sm">
            Email
            <Input name="email" type="email" required maxLength={254} />
          </label>
          <label className="grid gap-1 text-sm">
            Role
            <select name="role" defaultValue="collector" className="h-9 rounded-md border bg-background px-2">
              <option value="owner">owner</option>
              <option value="accountant">accountant</option>
              <option value="collector">collector</option>
            </select>
          </label>
          <Button type="submit">Invite</Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
