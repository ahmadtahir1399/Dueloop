"use client";

import { Button } from "@/components/ui/button";
import { Field, FormError, FormSuccess } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { killSwitchSchema } from "@/forms/schemas";
import type { ActionState } from "@/lib/actions";
import { useActionForm } from "@/lib/use-action-form";
import { setPaused } from "./actions";

/**
 * S24 kill switch (F18). A typed confirmation that works without JavaScript: the owner types PAUSE or RESUME (the
 * existing server check, CONFLICTS C-20). Stopping is the destructive button; resuming is a normal one.
 */
export function KillSwitch({ paused, businessName }: { paused: boolean; businessName: string }) {
  const word = paused ? "RESUME" : "PAUSE";
  const schema = killSwitchSchema(word);
  const { form, state, pending, formProps, errorId } = useActionForm<ActionState, typeof schema>({
    schema,
    action: setPaused,
    initial: {},
    defaultValues: { confirm: "" },
    id: "kill",
  });
  return (
    <form {...formProps} className="grid gap-3" aria-label="Kill switch">
      <input type="hidden" name="paused" value={paused ? "false" : "true"} />
      <p className="t-body-md prose-width">
        {paused
          ? `Sending is paused for ${businessName}. Resuming lets due reminders and receipts go out again (quiet hours and approvals still apply).`
          : `No reminders or receipts will go out for ${businessName} until an owner turns sending back on, including ones already approved. Nothing already sent changes.`}
      </p>
      <FormError id={errorId} message={state.error} />
      <Field id="kill-confirm" label={`Type ${word} to confirm`} error={form.formState.errors.confirm?.message as string | undefined} className="max-w-60">
        {(a) => <Input {...a} autoComplete="off" {...form.register("confirm")} />}
      </Field>
      <Button type="submit" variant={paused ? "default" : "destructive"} className="w-fit" loading={pending} loadingLabel={paused ? "Resuming…" : "Stopping…"}>
        {paused ? "Resume sending" : "Pause all sending"}
      </Button>
      <FormSuccess message={state.message} />
    </form>
  );
}
