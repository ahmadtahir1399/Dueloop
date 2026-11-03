"use client";

import { Button } from "@/components/ui/button";
import { Checkbox, FieldMessage, FormError, FormSuccess } from "@/components/ui/field";
import { reconcileSchema } from "@/forms/schemas";
import type { ActionState } from "@/lib/actions";
import { useActionForm } from "@/lib/use-action-form";
import { reconcile } from "./actions";

/** F10: what did the provider say? The two outcomes the server accepts (sent / not sent), after a required check. */
export function ReconcileForm({ messageId }: { messageId: string }) {
  const { form, state, pending, formProps, errorId } = useActionForm<ActionState, typeof reconcileSchema>({
    schema: reconcileSchema,
    action: reconcile,
    initial: {},
    id: `reconcile-${messageId}`,
  });
  return (
    <form {...formProps} aria-label="What did the provider say?" className="grid gap-3 border-t border-line pt-4">
      <input type="hidden" name="message" value={messageId} />
      <FormError id={errorId} message={state.error} />
      <Checkbox value="1" label="I checked with the provider (or the customer)" {...form.register("checked")} />
      <FieldMessage message={form.formState.errors.checked?.message as string | undefined} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="as" value="not_sent" variant="outline" disabled={pending}>
          It was not sent
        </Button>
        <Button type="submit" name="as" value="sent" disabled={pending}>
          It was sent
        </Button>
      </div>
      <FormSuccess message={state.message} />
    </form>
  );
}
