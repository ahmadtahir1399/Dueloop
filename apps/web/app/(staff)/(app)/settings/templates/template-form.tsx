"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { templateAction, type TemplateState } from "./actions";

export function TemplateForm(p: { id: string; channel: string; subject: string | null; body: string; status: string | null; canEdit: boolean; canApprove: boolean }) {
  const [state, action, pending] = useActionState<TemplateState, FormData>(templateAction, {});
  const v = state.draft ?? { subject: p.subject ?? "", body: p.body };
  const pv = state.preview;
  return (
    <form action={action} className="grid gap-2" key={JSON.stringify(state.draft ?? null)} aria-label="Template">
      <input type="hidden" name="template" value={p.id} />
      {p.channel === "whatsapp" ? (
        <p className="text-sm text-muted-foreground" data-testid="wa-status">
          Provider status: {p.status ?? "unknown"}. WhatsApp sends only text Meta approved; editing it here marks it for resubmission and stops
          sending until an owner confirms Meta approved the new text.
        </p>
      ) : null}
      {p.subject !== null ? (
        <label className="grid gap-1 text-sm">
          Subject
          <Input name="subject" defaultValue={v.subject} maxLength={200} disabled={!p.canEdit} />
        </label>
      ) : null}
      <label className="grid gap-1 text-sm">
        Body (variables like {"{{invoice_number}}"}; unknown variables are refused)
        <textarea name="body" defaultValue={v.body} rows={8} maxLength={5000} dir="auto" className="rounded-md border bg-background p-2 text-sm" disabled={!p.canEdit} />
      </label>
      {p.channel === "whatsapp" ? (
        <p className="text-xs text-muted-foreground">WhatsApp sends only the text Meta approved; no footer is added. Include an opt-out line such as "Reply STOP to stop these reminders." in it.</p>
      ) : (
        <p className="text-xs text-muted-foreground">The opt-out footer is added after your text when the message is sent. It cannot be edited or removed.</p>
      )}
      {pv ? (
        <div className="grid gap-1 rounded-md bg-muted/40 p-3 text-sm" role="status" data-testid="template-preview">
          {pv.subject && !pv.subject.ok ? <p className="text-destructive">Subject: {pv.subject.error}</p> : null}
          {pv.body.ok ? <pre className="whitespace-pre-wrap font-sans">{pv.sent}</pre> : <p className="text-destructive">Body: {pv.body.error}</p>}
          {pv.warnings.length ? (
            <p className="text-destructive" data-testid="wording-warning">
              Wording warning (not legal advice): {pv.warnings.join(", ")}. Reminders should stay neutral.
            </p>
          ) : null}
        </div>
      ) : null}
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state.message ? <p role="status" className="text-sm text-success">{state.message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {p.canEdit ? (
          <>
            <Button type="submit" name="op" value="preview" variant="outline" disabled={pending}>
              Preview
            </Button>
            <Button type="submit" name="op" value="save" disabled={pending}>
              Save
            </Button>
          </>
        ) : null}
        {p.canApprove && p.channel === "whatsapp" && (p.status === "needs_resubmission" || p.status === "pending") ? (
          <Button type="submit" name="op" value="approve" variant="outline" disabled={pending}>
            Meta approved this text
          </Button>
        ) : null}
      </div>
    </form>
  );
}
