"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionState } from "@/lib/actions";
import { Result } from "@/components/action-result";
import { resolveTask } from "../actions";

export function TaskForm({ taskId, open }: { taskId: string; open: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resolveTask, {});
  return (
    <form action={action} className="grid gap-2 rounded-lg border p-4">
      <input type="hidden" name="task" value={taskId} />
      <input type="hidden" name="op" value={open ? "resolve" : "reopen"} />
      <label htmlFor="task-note" className="text-sm font-medium">
        {open ? "How was it resolved?" : "Why reopen it?"}
      </label>
      <Input id="task-note" name="note" required minLength={3} maxLength={500} aria-describedby="task-note-help" />
      <p id="task-note-help" className="text-xs text-muted-foreground">
        Your name and this note are recorded.
      </p>
      <Button type="submit" size="sm" className="w-fit" disabled={pending}>
        {open ? "Resolve" : "Reopen"}
      </Button>
      <Result state={state} />
    </form>
  );
}

/** The draft is shown as read-only text with a copy button (progressive enhancement); it is never sent. */
export function CopyDraft({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI-generated, untrusted: check every word</p>
      <textarea readOnly value={text} rows={8} dir="auto" className="rounded-md border bg-muted/30 p-2 text-sm" aria-label="Suggested reply" />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy text"}
      </Button>
    </div>
  );
}
