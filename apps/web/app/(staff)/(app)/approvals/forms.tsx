"use client";

import { useActionState } from "react";
import { Result } from "@/components/action-result";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Fieldset, FormError, FormSuccess, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { bulkApproveSchema, editApprovalSchema, rejectApprovalSchema } from "@/forms/schemas";
import type { ActionState } from "@/lib/actions";
import { useActionForm } from "@/lib/use-action-form";
import { bulkApprove, decideApproval, editApproval } from "./actions";

/**
 * Exactly two decisions per item (§4.5). Approve is immediate (no extra confirm); Reject needs a reason, which the
 * server requires too (CONFLICTS C-12). Both forms post the same fields as before to decideApproval.
 */
export function ActionForm({ approvalId, subject, body, channel }: { approvalId: string; subject: string; body: string; channel: string }) {
  const [approved, approve, approving] = useActionState<ActionState, FormData>(decideApproval, {});
  const reject = useActionForm<ActionState, typeof rejectApprovalSchema>({
    schema: rejectApprovalSchema,
    action: decideApproval,
    initial: {},
    defaultValues: { note: "" },
    id: `reject-${approvalId}`,
  });
  const edit = useActionForm<ActionState, typeof editApprovalSchema>({
    schema: editApprovalSchema,
    action: editApproval,
    initial: {},
    defaultValues: { subject, body },
    id: `edit-${approvalId}`,
  });
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-4">
        <form {...reject.formProps} aria-label="Reject" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="approval" value={approvalId} />
          <input type="hidden" name="decision" value="reject" />
          <Field id={`note-${approvalId}`} label="Reason (needed to reject)" error={reject.form.formState.errors.note?.message as string | undefined} className="w-64">
            {(a) => <Input {...a} maxLength={500} {...reject.form.register("note")} />}
          </Field>
          <Button type="submit" variant="outline" loading={reject.pending} loadingLabel="Rejecting…" disabled={approving}>
            Reject
          </Button>
        </form>
        <form action={approve} aria-label="Approve">
          <input type="hidden" name="approval" value={approvalId} />
          <Button type="submit" name="decision" value="approve" loading={approving} loadingLabel="Approving…" disabled={reject.pending}>
            Approve
          </Button>
        </form>
      </div>
      <FormError id={reject.errorId} message={reject.state.error} />
      <Result state={approved} />
      <FormSuccess message={reject.state.message} />
      {channel === "email" ? (
        <details className="rounded-lg border border-line">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 t-body-sm font-semibold text-link">Edit before sending</summary>
          <form {...edit.formProps} aria-label="Edit before sending" className="grid gap-3 border-t border-line p-4">
            <input type="hidden" name="approval" value={approvalId} />
            <FormError id={edit.errorId} message={edit.state.error} />
            <Field id={`subject-${approvalId}`} label="Subject" error={edit.form.formState.errors.subject?.message as string | undefined}>
              {(a) => <Input {...a} maxLength={200} {...edit.form.register("subject")} />}
            </Field>
            <Field
              id={`body-${approvalId}`}
              label="Message"
              help="The footer with the opt-out link is added after this and cannot be removed."
              error={edit.form.formState.errors.body?.message as string | undefined}
            >
              {(a) => <Textarea {...a} maxLength={5000} rows={8} {...edit.form.register("body")} />}
            </Field>
            <Button type="submit" variant="outline" loading={edit.pending} className="w-fit">
              Save edit and refresh preview
            </Button>
            <FormSuccess message={edit.state.message} />
          </form>
        </details>
      ) : (
        <p className="t-caption text-ink-muted">WhatsApp messages use the approved template text and cannot be edited here.</p>
      )}
    </div>
  );
}

/** Bulk approve: the human confirms the exact count; a mismatch approves nothing (server checks it again). */
export function BulkApproveForm({ ids }: { ids: { id: string; label: string }[] }) {
  const { form, state, pending, formProps, errorId } = useActionForm<ActionState, typeof bulkApproveSchema>({
    schema: bulkApproveSchema,
    action: bulkApprove,
    initial: {},
    defaultValues: { confirm_count: "" },
    id: "bulk",
  });
  const e = form.formState.errors;
  return (
    <form {...formProps} className="card-edge grid gap-4 rounded-xl border border-line bg-panel p-5" aria-label="Approve several">
      <FormError id={errorId} message={state.error} />
      <Fieldset legend="Approve several at once" error={e.approval?.message as string | undefined}>
        <div className="grid gap-0 sm:grid-cols-2">
          {ids.map((i) => (
            <Checkbox key={i.id} value={i.id} label={i.label} {...form.register("approval")} />
          ))}
        </div>
      </Fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <Field id="confirm_count" label="Type how many you selected, to confirm" error={e.confirm_count?.message as string | undefined}>
          {(a) => <Input {...a} inputMode="numeric" className="w-28" {...form.register("confirm_count")} />}
        </Field>
        <Button type="submit" variant="outline" loading={pending} loadingLabel="Approving…">
          Approve selected
        </Button>
      </div>
      {state.message ? <Result state={state} /> : null}
    </form>
  );
}
