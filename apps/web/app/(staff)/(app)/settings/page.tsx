import { can } from "@dueloop/authz";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { loadGlobalPause } from "@/lib/shell";
import { tenantToday } from "@/lib/time";
import { KillSwitch } from "./kill-switch";

const APPROVAL: Record<string, string> = {
  always: "Every reminder waits for approval",
  low_confidence: "Only uncertain reminders wait for approval",
  never: "Reminders are sent without approval",
};
const PROMISE: Record<string, string> = {
  auto: "Valid promises pause reminders automatically",
  review: "Every promise is reviewed by a person first",
};

export default async function SettingsPage() {
  const ctx = await requirePermission("settings.view");
  const { data: t, error } = await ctx.supabase
    .from("tenants")
    .select("name, timezone, currency, quiet_start_hour, quiet_end_hour, approval_mode, promise_acceptance, monthly_message_budget_minor::text, bank_instructions, proof_ai_extraction, outbound_paused")
    .eq("id", ctx.tenant.id)
    .single();
  if (error || !t) throw new Error("could not load settings");
  const globalPaused = await loadGlobalPause(ctx);
  const today = tenantToday(ctx.tenant.timezone, new Date());
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sending</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm" data-testid="pause-state">
            {t.outbound_paused ? "Paused for this business." : "Active for this business."}
            {globalPaused ? " Also paused for everyone by the operator." : ""}
          </p>
          {can(ctx.role, "killswitch.toggle") ? <KillSwitch paused={t.outbound_paused} /> : <p className="text-sm text-muted-foreground">Only an owner can pause or resume sending.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current settings</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]">
            <dt className="text-muted-foreground">Business name</dt>
            <dd><UntrustedText text={t.name} /></dd>
            <dt className="text-muted-foreground">Time zone</dt>
            <dd>{t.timezone}</dd>
            <dt className="text-muted-foreground">Currency</dt>
            <dd>{t.currency}</dd>
            <dt className="text-muted-foreground">Quiet hours (no messages)</dt>
            <dd>{t.quiet_start_hour === t.quiet_end_hour ? "None" : `${pad(t.quiet_start_hour)} to ${pad(t.quiet_end_hour)}, ${t.timezone}`}</dd>
            <dt className="text-muted-foreground">Approvals</dt>
            <dd>{APPROVAL[t.approval_mode] ?? t.approval_mode}</dd>
            <dt className="text-muted-foreground">Promises from customers</dt>
            <dd>{PROMISE[t.promise_acceptance] ?? t.promise_acceptance}</dd>
            <dt className="text-muted-foreground">Monthly message budget</dt>
            <dd>{t.monthly_message_budget_minor === "0" ? "No budget set (unlimited)" : formatMinor(t.monthly_message_budget_minor, t.currency)}</dd>
            <dt className="text-muted-foreground">Bank details shown to customers</dt>
            <dd><UntrustedText text={t.bank_instructions} /></dd>
            <dt className="text-muted-foreground">AI reading of payment proofs</dt>
            <dd>{t.proof_ai_extraction ? "On" : "Off"}</dd>
          </dl>
        </CardContent>
      </Card>

      {can(ctx.role, "export.audit") ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Audit log export</CardTitle>
          </CardHeader>
          <CardContent>
            <form method="get" action="/exports/audit" className="flex flex-wrap items-end gap-2 text-sm">
              <div className="grid gap-1">
                <label htmlFor="audit-from">From</label>
                <Input id="audit-from" name="from" type="date" required max={today} />
              </div>
              <div className="grid gap-1">
                <label htmlFor="audit-to">To</label>
                <Input id="audit-to" name="to" type="date" required defaultValue={today} max={today} />
              </div>
              <Button type="submit" variant="outline">
                Download CSV
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">
              Days are in {ctx.tenant.timezone}. Contact details, message text and AI text are left out. Every export is recorded.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
