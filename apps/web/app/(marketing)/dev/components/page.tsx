import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CodeValue } from "@/components/ui/code-value";
import { CountBadge } from "@/components/ui/count-badge";
import { Checkbox, Field, MoneyInput } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { KpiTile } from "@/components/ui/kpi-tile";
import { STATUS_VISUAL, StatusChip } from "@/components/ui/status-chip";
import { Stepper } from "@/components/ui/stepper";
import { devOnly } from "@/lib/dev-only";

export const metadata = { robots: { index: false, follow: false } };

/** /dev/components: every primitive and its states (dev only, §9 Phase 2; axe runs on it). */
export default function DevComponentsPage() {
  devOnly();
  return (
    <main className="mx-auto grid max-w-5xl gap-10 p-8">
      <h1 className="t-display-lg">Components</h1>
      {(["light", "dark"] as const).map((theme) => (
        <section key={theme} aria-label={`${theme} theme`} className={`${theme} grid gap-6 rounded-2xl bg-canvas p-6 text-ink`}>
          <h2 className="t-heading-lg capitalize">{theme}</h2>
          <div className="flex flex-wrap gap-3">
            <Button>Primary</Button>
            <Button loading>Primary</Button>
            <Button variant="outline">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Stop sending</Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(STATUS_VISUAL).map((s) => (
              <StatusChip key={s} status={s} />
            ))}
            <CountBadge count={3} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`f1-${theme}`} label="Bank reference" help="Shown on the receipt.">
              {(a) => <Input {...a} defaultValue="FT-20261102-88" />}
            </Field>
            <Field id={`f2-${theme}`} label="Amount">
              {(a) => <MoneyInput {...a} currency="USD" defaultValue="12,400.00" />}
            </Field>
            <Field id={`f3-${theme}`} label="Received on" error="The payment date can't be in the future.">
              {(a) => <DatePicker {...a} defaultValue="2026-11-09" />}
            </Field>
            <Field id={`f4-${theme}`} label="Status">
              {(a) => <ChoiceSelect id={a.id} name={`status-${theme}`} defaultValue="" options={[{ value: "", label: "Any" }, { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid" }]} />}
            </Field>
            <Checkbox label="I checked with the provider" />
          </div>
          <div className="grid gap-3">
            <Banner tone="success" title="Payment recorded.">INV-2041 is now paid.</Banner>
            <Banner tone="error">We couldn&apos;t save this. Check your connection and try again.</Banner>
            <Banner tone="warning">Reminders paused. The result of the last send is unknown.</Banner>
            <Banner tone="paused" title="Sending is paused">for Acme Ltd. Owners can turn it back on in Settings.</Banner>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <KpiTile label="Overdue" value="31,940" sub="USD · 18 invoices" />
            <CodeValue value="reminder:inv-2041:2:v1" label="idempotency key" />
          </div>
          <Stepper steps={["Upload", "Match columns", "Preview", "Done"]} current={1} />
          <EmptyState title="Nothing to approve" icon={Inbox} headingLevel={3}>
            New reminders that need approval will appear here.
          </EmptyState>
        </section>
      ))}
    </main>
  );
}
