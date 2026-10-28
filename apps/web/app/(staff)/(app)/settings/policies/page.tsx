import { can } from "@dueloop/authz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listPolicies } from "@/lib/data/policies";
import { requirePermission } from "@/lib/session";
import { PolicyForm } from "./policy-form";

export default async function PoliciesPage() {
  const ctx = await requirePermission("settings.view");
  const policies = await listPolicies(ctx);
  const canEdit = can(ctx.role, "policies.edit");
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Reminder policies</h1>
      <p className="text-sm text-muted-foreground">
        Changing days or channel affects only steps not yet sent. A step that was sent is never sent again: the system remembers sent steps by
        their id, and ids never change.
      </p>
      {policies.map((p) => {
        const steps = Array.isArray(p.steps) ? (p.steps as { id: string; daysAfterDue: number; channel: string; templateKey: string }[]) : [];
        return (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {p.name}
                {p.is_default ? " (default)" : ""}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PolicyForm id={p.id} name={p.name} isDefault={p.is_default} steps={steps} escalate={p.escalate_after_days} grace={p.grace_days_after_promise} maxWeek={p.max_messages_per_week} canEdit={canEdit} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
