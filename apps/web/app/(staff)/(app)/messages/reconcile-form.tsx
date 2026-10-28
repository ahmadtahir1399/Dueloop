"use client";

import { useActionState } from "react";
import { Result } from "@/components/action-result";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions";
import { reconcile } from "./actions";

export function ReconcileForm({ messageId }: { messageId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reconcile, {});
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="message" value={messageId} />
      <label className="flex items-center gap-2">
        <input type="checkbox" name="checked" value="1" required /> I checked with the provider (or the customer)
      </label>
      <div className="flex gap-2">
        <Button type="submit" name="as" value="sent" size="sm" disabled={pending}>
          It was sent
        </Button>
        <Button type="submit" name="as" value="not_sent" size="sm" variant="outline" disabled={pending}>
          It was not sent
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}
