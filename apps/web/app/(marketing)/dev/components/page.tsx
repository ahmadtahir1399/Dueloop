import { Inbox, Search } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CodeValue } from "@/components/ui/code-value";
import { CountBadge } from "@/components/ui/count-badge";
import { Checkbox, Field, MoneyInput } from "@/components/ui/field";
import { Combobox } from "@/components/ui/combobox";
import { Input, SearchInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
          <FieldStates theme={theme} />
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

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "overdue", label: "Overdue" },
  { value: "promised", label: "Promised" },
  { value: "paid", label: "Paid" },
];
const ZONES = ["Africa/Lagos", "America/New_York", "Asia/Karachi", "Europe/London", "Pacific/Auckland"].map((z) => ({ value: z, label: z }));

/** Every field state from the §7.3 table (D22). Hover and focus are shown with the classes those states apply. */
function FieldStates({ theme }: { theme: "light" | "dark" }) {
  const id = (n: string) => `fs-${n}-${theme}`;
  return (
    <div className="grid gap-4" data-testid={`field-states-${theme}`}>
      <h3 className="t-heading-md">Fields (§7.3)</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id={id("default")} label="Default" help="Help text sits under the field.">
          {(a) => <Input {...a} placeholder="Placeholder text" />}
        </Field>
        <Field id={id("hover")} label="Hover (shown)">
          {(a) => <Input {...a} defaultValue="Border turns text colour" className="border-ink" />}
        </Field>
        <Field id={id("focus")} label="Focus (shown)">
          {(a) => <Input {...a} defaultValue="Primary border and ring" className="border-brand outline-focus" />}
        </Field>
        <Field id={id("required")} label="Required" required>
          {(a) => <Input {...a} />}
        </Field>
        <Field id={id("invalid")} label="Invalid" error="Enter the bank reference so this payment can be traced.">
          {(a) => <Input {...a} defaultValue="" />}
        </Field>
        <Field id={id("readonly")} label="Read-only">
          {(a) => <Input {...a} readOnly defaultValue="Europe/London" />}
        </Field>
        <Field id={id("disabled")} label="Disabled">
          {(a) => <Input {...a} disabled defaultValue="Not editable" />}
        </Field>
        <Field id={id("search")} label="Search with text (clear ×)">
          {(a) => <SearchInput {...a} defaultValue="north" leading={<Search />} />}
        </Field>
        <Field id={id("small")} label="Small (filter bars)">
          {(a) => <Input {...a} size="sm" placeholder="36 px" />}
        </Field>
        <Field id={id("textarea")} label="Textarea with counter" help="Grows up to 10 lines.">
          {(a) => <Textarea {...a} maxLength={500} defaultValue="Customer said they will pay on Friday." />}
        </Field>
        <Field id={id("select")} label="Select">
          {(a) => <ChoiceSelect id={a.id} options={STATUS_OPTIONS} defaultValue="overdue" />}
        </Field>
        <Field id={id("select-ph")} label="Select, placeholder">
          {(a) => <ChoiceSelect id={a.id} options={STATUS_OPTIONS} value="" placeholder="Choose a status" />}
        </Field>
        <Field id={id("select-invalid")} label="Select, invalid" error="Choose a status.">
          {(a) => <ChoiceSelect id={a.id} options={STATUS_OPTIONS} value="" placeholder="Choose a status" invalid describedBy={a["aria-describedby"]} />}
        </Field>
        <Field id={id("select-disabled")} label="Select, disabled">
          {(a) => <ChoiceSelect id={a.id} options={STATUS_OPTIONS} defaultValue="paid" disabled />}
        </Field>
        <Field id={id("combobox")} label="Combobox (searchable)">
          {(a) => <Combobox id={a.id} options={ZONES} defaultValue="Asia/Karachi" searchLabel="Search time zones" />}
        </Field>
        <Field id={id("date")} label="Date">
          {(a) => <DatePicker {...a} defaultValue="2026-11-03" />}
        </Field>
      </div>
    </div>
  );
}
