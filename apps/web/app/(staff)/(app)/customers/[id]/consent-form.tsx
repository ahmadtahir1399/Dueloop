"use client";

import { Button } from "@/components/ui/button";
import { RhfSelect } from "@/components/ui/choice-select";
import { Field, FormError, FormSuccess } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { consentSchema } from "@/forms/schemas";
import type { ActionState } from "@/lib/actions";
import { useActionForm } from "@/lib/use-action-form";
import { consentAction } from "./actions";

/** F11 Record consent (owner, accountant). The source is kept as evidence; the server checks it again. */
export function ConsentForm({ customerId }: { customerId: string }) {
  const { form, state, pending, formProps, errorId } = useActionForm<ActionState, typeof consentSchema>({
    schema: consentSchema,
    action: consentAction,
    initial: {},
    defaultValues: { channel: "whatsapp", source: "" },
    id: "consent",
  });
  const e = form.formState.errors;
  return (
    <form {...formProps} aria-label="Record consent" className="grid gap-3">
      <input type="hidden" name="op" value="grant" />
      <input type="hidden" name="customer" value={customerId} />
      <FormError id={errorId} message={state.error} />
      <Field id="consent-channel" label="Channel" error={e.channel?.message as string | undefined}>
        {(a) => (
          <RhfSelect control={form.control} name="channel" field={a} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "Email" }]} />
        )}
      </Field>
      <Field id="consent-source" label="How did they agree? (kept as evidence)" error={e.source?.message as string | undefined}>
        {(a) => <Input {...a} maxLength={200} autoComplete="off" {...form.register("source")} />}
      </Field>
      <Button type="submit" variant="outline" loading={pending} className="w-fit">
        Record consent
      </Button>
      <FormSuccess message={state.message} />
    </form>
  );
}
