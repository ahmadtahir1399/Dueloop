"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { policyAction, type PolicyState } from "./actions";

interface Step {
  id: string;
  daysAfterDue: number;
  channel: string;
  templateKey: string;
}

export function PolicyForm(p: { id: string; name: string; isDefault: boolean; steps: Step[]; escalate: number; grace: number; maxWeek: number; canEdit: boolean }) {
  const [state, action, pending] = useActionState<PolicyState, FormData>(policyAction, {});
  const v = state.draft ?? p;
  return (
    <form action={action} className="grid gap-3" aria-label={`Policy ${p.name}`} key={JSON.stringify(state.draft ?? null)}>
      <input type="hidden" name="policy" value={p.id} />
      <input type="hidden" name="is_default" value={String(p.isDefault)} />
      <label className="grid gap-1 text-sm">
        Name
        <Input name="name" defaultValue={v.name} maxLength={80} disabled={!p.canEdit} />
      </label>
      <table className="w-full text-sm">
        <caption className="text-left text-muted-foreground">Steps (ids are assigned by the system and never change)</caption>
        <thead>
          <tr className="text-left">
            <th scope="col">Step id</th>
            <th scope="col">Days after due</th>
            <th scope="col">Channel</th>
            <th scope="col">Template</th>
            <th scope="col">Remove</th>
          </tr>
        </thead>
        <tbody>
          {[...v.steps, { id: "", daysAfterDue: NaN, channel: "email", templateKey: "" }].map((s, i) => (
            <tr key={s.id || `new-${i}`}>
              <td className="font-mono text-xs">
                {s.id || "new"}
                <input type="hidden" name="step_id" value={s.id} />
              </td>
              <td>
                <Input name="step_days" aria-label={`Days after due for ${s.id || "a new step"}`} inputMode="numeric" defaultValue={Number.isNaN(s.daysAfterDue) ? "" : String(s.daysAfterDue)} className="h-8 w-20" disabled={!p.canEdit} />
              </td>
              <td>
                <select name="step_channel" aria-label={`Channel for ${s.id || "a new step"}`} defaultValue={s.channel} className="h-8 rounded-md border bg-background px-2" disabled={!p.canEdit}>
                  <option value="email">email</option>
                  <option value="whatsapp">whatsapp</option>
                  <option value="sms">sms</option>
                </select>
              </td>
              <td>
                <Input name="step_template" aria-label={`Template for ${s.id || "a new step"}`} defaultValue={s.templateKey} className="h-8 w-32" disabled={!p.canEdit} />
              </td>
              <td>{s.id ? <input type="checkbox" name="step_remove" value={s.id} aria-label={`Remove ${s.id}`} disabled={!p.canEdit} /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Escalate after (days)
          <Input name="escalate" defaultValue={String(v.escalate)} inputMode="numeric" disabled={!p.canEdit} />
        </label>
        <label className="grid gap-1 text-sm">
          Grace after a promise (days)
          <Input name="grace" defaultValue={String(v.grace)} inputMode="numeric" disabled={!p.canEdit} />
        </label>
        <label className="grid gap-1 text-sm">
          Max messages a week
          <Input name="max_week" defaultValue={String(v.maxWeek)} inputMode="numeric" disabled={!p.canEdit} />
        </label>
      </div>
      {state.impact ? (
        <div role="status" className="grid gap-1 rounded-md bg-muted/40 p-3 text-sm" data-testid="policy-impact">
          <p className="font-medium">{state.impact.invoices} open invoices use this policy and will be re-checked after saving.</p>
          {state.impact.lines.map((l) => (
            <p key={l.invoiceNumber}>
              {l.invoiceNumber}: {l.outcome}
            </p>
          ))}
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" name="confirm" value="1" /> I checked the impact
          </label>
        </div>
      ) : null}
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state.message ? <p role="status" className="text-sm text-success">{state.message}</p> : null}
      {p.canEdit ? (
        <div className="flex gap-2">
          <Button type="submit" name="op" value="impact" variant="outline" disabled={pending}>
            Check impact
          </Button>
          <Button type="submit" name="op" value="save" disabled={pending || !state.impact}>
            Save policy
          </Button>
        </div>
      ) : null}
    </form>
  );
}
