"use client";

import { useActionState } from "react";
import { Result } from "@/components/action-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionState } from "@/lib/actions";
import { setPaused } from "./actions";

/** A confirm step that works without JavaScript: the owner types PAUSE or RESUME. */
export function KillSwitch({ paused }: { paused: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setPaused, {});
  const word = paused ? "RESUME" : "PAUSE";
  return (
    <form action={action} className="grid gap-2" aria-label="Kill switch">
      <input type="hidden" name="paused" value={paused ? "false" : "true"} />
      <p className="text-sm">
        {paused
          ? "Sending is paused for this business. Resuming lets due reminders and receipts go out again (quiet hours and approvals still apply)."
          : "Pausing stops every reminder and receipt for this business at once, including ones already approved."}
      </p>
      <label htmlFor="kill-confirm" className="text-sm">
        Type {word} to confirm
      </label>
      <Input id="kill-confirm" name="confirm" autoComplete="off" className="w-40" required />
      <Button type="submit" variant={paused ? "default" : "destructive"} className="w-fit" disabled={pending}>
        {paused ? "Resume sending" : "Pause all sending"}
      </Button>
      <Result state={state} />
    </form>
  );
}
