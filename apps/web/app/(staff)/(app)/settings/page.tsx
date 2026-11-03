import { can } from "@dueloop/authz";
import { UntrustedText } from "@/components/untrusted-text";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Chip } from "@/components/ui/status-chip";
import { zoneOptions } from "@/lib/field-options";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { loadGlobalPause } from "@/lib/shell";
import { tenantToday } from "@/lib/time";
import { KillSwitch } from "./kill-switch";
import { SettingsForm } from "./settings-form";

const APPROVAL: Record<string, string> = {
  always: "Every reminder waits for approval",
  low_confidence: "Only uncertain reminders wait for approval",
  never: "Reminders are sent without approval",
};
const PROMISE: Record<string, string> = {
  auto: "Valid promises pause reminders automatically",
  review: "Every promise is reviewed by a person first",
};

/** S17 Settings · General. Owners edit; other roles see values as text, not disabled inputs (§4.6). */
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
  const mayEdit = can(ctx.role, "settings.edit");
  return (
    <div className="grid gap-8">
      <PageHeader title="Settings" description={<UntrustedText text={t.name} />} />

      <section aria-labelledby="general-h" className="card-edge grid gap-5 rounded-xl border border-line bg-panel p-5 md:p-6">
        <SectionTitle id="general-h">General</SectionTitle>
        {mayEdit ? (
          <SettingsForm
            currency={t.currency}
            zones={zoneOptions(t.timezone)}
            values={{
              timezone: t.timezone,
              quiet_start: String(t.quiet_start_hour),
              quiet_end: String(t.quiet_end_hour),
              approval_mode: t.approval_mode,
              promise_acceptance: t.promise_acceptance,
              budget: t.monthly_message_budget_minor,
              bank_instructions: t.bank_instructions ?? "",
              proof_ai_extraction: t.proof_ai_extraction,
            }}
          />
        ) : (
          <dl className="grid gap-x-6 gap-y-3 t-body-sm sm:grid-cols-[14rem_1fr]">
            <dt className="text-ink-muted">Business name</dt>
            <dd>
              <UntrustedText text={t.name} />
            </dd>
            <dt className="text-ink-muted">Time zone</dt>
            <dd>{t.timezone}</dd>
            <dt className="text-ink-muted">Currency</dt>
            <dd>{t.currency}</dd>
            <dt className="text-ink-muted">Quiet hours (no messages)</dt>
            <dd>{t.quiet_start_hour === t.quiet_end_hour ? "None" : `${pad(t.quiet_start_hour)} to ${pad(t.quiet_end_hour)}, ${t.timezone}`}</dd>
            <dt className="text-ink-muted">Approvals</dt>
            <dd>{APPROVAL[t.approval_mode] ?? t.approval_mode}</dd>
            <dt className="text-ink-muted">Promises from customers</dt>
            <dd>{PROMISE[t.promise_acceptance] ?? t.promise_acceptance}</dd>
            <dt className="text-ink-muted">Monthly message budget</dt>
            <dd>{t.monthly_message_budget_minor === "0" ? "0: WhatsApp and SMS are blocked (email is not limited)" : formatMinor(t.monthly_message_budget_minor, t.currency)}</dd>
            <dt className="text-ink-muted">Bank details shown to customers</dt>
            <dd>
              <UntrustedText text={t.bank_instructions} />
            </dd>
            <dt className="text-ink-muted">AI reading of payment proofs</dt>
            <dd>{t.proof_ai_extraction ? "On" : "Off"}</dd>
          </dl>
        )}
      </section>

      {can(ctx.role, "export.audit") ? (
        <section aria-labelledby="audit-h" className="card-edge grid gap-4 rounded-xl border border-line bg-panel p-5 md:p-6">
          <SectionTitle id="audit-h">Audit log export</SectionTitle>
          <form method="get" action="/exports/audit" className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="audit-from" className="t-body-sm font-semibold">
                From
              </label>
              <DatePicker id="audit-from" name="from" required max={today} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="audit-to" className="t-body-sm font-semibold">
                To
              </label>
              <DatePicker id="audit-to" name="to" required defaultValue={today} max={today} />
            </div>
            <Button type="submit" variant="outline">
              Download CSV
            </Button>
          </form>
          <p className="t-caption text-ink-muted">Days are in {ctx.tenant.timezone}. Contact details, message text and AI text are left out. Every export is recorded.</p>
        </section>
      ) : null}

      <section id="sending" aria-labelledby="sending-h" className="grid gap-4 rounded-xl border border-error-line p-5 md:p-6">
        <SectionTitle id="sending-h" action={t.outbound_paused ? <Chip tone="warning">Paused</Chip> : <Chip tone="success">On</Chip>}>
          Danger zone · Stop all sending
        </SectionTitle>
        <p className="t-body-sm" data-testid="pause-state">
          {t.outbound_paused ? "Paused for this business." : "Active for this business."}
          {globalPaused ? " Also paused for everyone by the operator." : ""}
        </p>
        {can(ctx.role, "killswitch.toggle") ? <KillSwitch paused={t.outbound_paused} businessName={t.name} /> : <p className="t-body-sm text-ink-muted">Only an owner can pause or resume sending.</p>}
      </section>
    </div>
  );
}
