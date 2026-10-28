"use client";

import { useActionState } from "react";
import { Result } from "@/components/action-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionState } from "@/lib/actions";
import { bulkApprove, decideApproval, editApproval } from "./actions";

export function ActionForm({ approvalId, subject, body, channel }: { approvalId: string; subject: string; body: string; channel: string }) {
  const [decided, decide, deciding] = useActionState<ActionState, FormData>(decideApproval, {});
  const [edited, edit, editing] = useActionState<ActionState, FormData>(editApproval, {});
  return (
    <div className="grid gap-2">
      <form action={decide} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="approval" value={approvalId} />
        <div className="grid gap-1">
          <label htmlFor={`note-${approvalId}`} className="text-xs">
            Reason (needed to reject)
          </label>
          <Input id={`note-${approvalId}`} name="note" className="h-8 w-64" maxLength={500} />
        </div>
        <Button type="submit" name="decision" value="approve" size="sm" disabled={deciding}>
          Approve
        </Button>
        <Button type="submit" name="decision" value="reject" size="sm" variant="outline" disabled={deciding}>
          Reject
        </Button>
      </form>
      <Result state={decided} />
      {channel === "email" ? (
        <details>
          <summary className="cursor-pointer text-sm">Edit before sending</summary>
          <form action={edit} className="mt-2 grid gap-2">
            <input type="hidden" name="approval" value={approvalId} />
            <label htmlFor={`subject-${approvalId}`} className="text-xs">
              Subject
            </label>
            <Input id={`subject-${approvalId}`} name="subject" defaultValue={subject} maxLength={200} />
            <label htmlFor={`body-${approvalId}`} className="text-xs">
              Message (the footer with the opt-out link is added after this and cannot be removed)
            </label>
            <textarea id={`body-${approvalId}`} name="body" defaultValue={body} maxLength={5000} rows={8} dir="auto" className="rounded-md border bg-background p-2 text-sm" />
            <Button type="submit" size="sm" variant="outline" disabled={editing} className="w-fit">
              Save edit and refresh preview
            </Button>
          </form>
          <Result state={edited} />
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">WhatsApp messages use the approved template text and cannot be edited here.</p>
      )}
    </div>
  );
}

export function BulkApproveForm({ ids }: { ids: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(bulkApprove, {});
  return (
    <form action={action} className="grid gap-3 rounded-lg border p-4" aria-label="Approve several">
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">Approve several at once</legend>
        {ids.map((i) => (
          <label key={i.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="approval" value={i.id} /> {i.label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="confirm_count" className="text-xs">
            Type how many you selected, to confirm
          </label>
          <Input id="confirm_count" name="confirm_count" inputMode="numeric" className="h-8 w-28" required />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          Approve selected
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}
