"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormSuccess, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { noteRequiredSchema } from "@/forms/schemas";
import type { ActionState } from "@/lib/actions";
import { useActionForm } from "@/lib/use-action-form";
import { resolveTask } from "../actions";

/** F08 Resolve / reopen a task. The note is recorded with the person's name (server requires >= 3 characters). */
export function TaskForm({ taskId, open }: { taskId: string; open: boolean }) {
  const { form, state, pending, formProps, errorId } = useActionForm<ActionState, typeof noteRequiredSchema>({
    schema: noteRequiredSchema,
    action: resolveTask,
    initial: {},
    defaultValues: { note: "" },
    id: "task",
  });
  return (
    <form {...formProps} aria-label={open ? "Resolve task" : "Reopen task"} className="card-edge grid content-start gap-4 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="task" value={taskId} />
      <input type="hidden" name="op" value={open ? "resolve" : "reopen"} />
      <h2 className="t-heading-md">{open ? "Resolve" : "Reopen"}</h2>
      <FormError id={errorId} message={state.error} />
      <Field
        id="task-note"
        label={open ? "How was it resolved?" : "Why reopen it?"}
        help="Your name and this note are recorded."
        error={form.formState.errors.note?.message as string | undefined}
      >
        {(a) => <Input {...a} maxLength={500} {...form.register("note")} />}
      </Field>
      <Button type="submit" loading={pending} className="w-fit">
        {open ? "Resolve" : "Reopen"}
      </Button>
      <FormSuccess message={state.message} />
    </form>
  );
}

/** The draft is shown as read-only text with a copy button (progressive enhancement); it is never sent. */
export function CopyDraft({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2">
      <p className="t-label">AI-generated, untrusted: check every word</p>
      <Textarea readOnly value={text} rows={8} aria-label="Suggested reply" className="bg-sunken" />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? "Copied" : "Copy text"}
      </Button>
    </div>
  );
}
