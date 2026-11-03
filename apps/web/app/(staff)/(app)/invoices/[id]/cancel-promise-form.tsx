"use client";

import { Button } from "@/components/ui/button";
import { Field, FormError, FormSuccess } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { noteRequiredSchema } from "@/forms/schemas";
import type { ActionState } from "@/lib/actions";
import { useActionForm } from "@/lib/use-action-form";
import { cancelPromise } from "./actions";

/** F22 Cancel promise: a short reason is required (server checks >= 3 characters). */
export function CancelPromiseForm({ promiseId }: { promiseId: string }) {
  const { form, state, pending, formProps, errorId } = useActionForm<ActionState, typeof noteRequiredSchema>({
    schema: noteRequiredSchema,
    action: cancelPromise,
    initial: {},
    defaultValues: { note: "" },
    id: `cancel-${promiseId}`,
  });
  return (
    <form {...formProps} aria-label="Cancel promise" className="grid gap-3">
      <input type="hidden" name="promise" value={promiseId} />
      <FormError id={errorId} message={state.error} />
      <Field id="cancel-note" label="Reason" error={form.formState.errors.note?.message as string | undefined}>
        {(a) => <Input {...a} maxLength={500} {...form.register("note")} />}
      </Field>
      <Button type="submit" size="sm" variant="outline" loading={pending} loadingLabel="Cancelling…" className="w-fit">
        Cancel promise
      </Button>
      <FormSuccess message={state.message} />
    </form>
  );
}
