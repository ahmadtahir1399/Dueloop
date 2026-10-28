import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionState } from "@/lib/actions";

/** The outcome of a server action, announced to screen readers. Text only. */
export function Result({ state, id }: { state: ActionState; id?: string }) {
  if (state.error)
    return (
      <Alert variant="destructive" role="alert" id={id}>
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    );
  if (state.message)
    return (
      <p role="status" id={id} className="text-sm text-success">
        {state.message}
      </p>
    );
  return null;
}
