"use client";

import { useActionState } from "react";
import { Result } from "@/components/action-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionState } from "@/lib/actions";
import { cancelPromise } from "./actions";

export function CancelPromiseForm({ promiseId }: { promiseId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelPromise, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="promise" value={promiseId} />
      <div className="grid gap-1">
        <label htmlFor="cancel-note" className="text-xs">
          Reason
        </label>
        <Input id="cancel-note" name="note" className="h-8 w-56" maxLength={500} required minLength={3} />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Cancel promise
      </Button>
      <Result state={state} />
    </form>
  );
}
