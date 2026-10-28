"use client";

import { useActionState, type ReactNode } from "react";
import { Result } from "@/components/action-result";
import type { ActionState } from "@/lib/actions";

/** A plain form bound to a server action, with an announced result. One-shot forms only (fields reset after). */
export function ActionForm({
  action,
  children,
  label,
  className,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const [state, run] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={run} aria-label={label} className={className ?? "grid gap-2"}>
      {children}
      <Result state={state} />
    </form>
  );
}

/** Same, but shows a one-time secret (API key or webhook URL) returned by the action. */
export function SecretOnceForm({
  action,
  children,
  label,
}: {
  action: (prev: ActionState & { secret?: string; webhookUrl?: string }, form: FormData) => Promise<ActionState & { secret?: string; webhookUrl?: string }>;
  children: ReactNode;
  label: string;
}) {
  const [state, run] = useActionState(action, {});
  const once = state.secret ?? state.webhookUrl;
  return (
    <form action={run} aria-label={label} className="grid gap-2">
      {children}
      <Result state={state} />
      {once ? (
        <div className="rounded-md border border-warning p-3 text-sm" data-testid="secret-once">
          <p className="font-medium">Shown once. Copy it now:</p>
          <code className="break-all">{once}</code>
        </div>
      ) : null}
    </form>
  );
}
