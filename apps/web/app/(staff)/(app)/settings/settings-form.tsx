"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RhfSelect, type Choice } from "@/components/ui/choice-select";
import { RhfCombobox } from "@/components/ui/combobox";
import { Checkbox, Field, FormError, FormSuccess, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { settingsSchema } from "@/forms/schemas";
import type { ActionState } from "@/lib/actions";
import { useActionForm } from "@/lib/use-action-form";
import { cn } from "cn";
import { settingsAction } from "./admin-actions";

export interface SettingsValues {
  timezone: string;
  quiet_start: string;
  quiet_end: string;
  approval_mode: string;
  promise_acceptance: string;
  budget: string;
  bank_instructions: string;
  proof_ai_extraction: boolean;
}

const APPROVAL: Record<string, string> = {
  always: "Every reminder waits for approval",
  low_confidence: "Only uncertain reminders wait for approval",
  never: "Reminders are sent without approval",
};
const PROMISE: Record<string, string> = {
  auto: "Valid promises pause reminders automatically",
  review: "Every promise is reviewed by a person first",
};

/**
 * F13 (the one SettingsForm pattern, C7): fields + a save bar that becomes sticky with "Unsaved changes" when the
 * form is dirty (M4). Leaving with unsaved changes asks first. The server action is unchanged.
 */
export function SettingsForm({ values, currency, zones }: { values: SettingsValues; currency: string; zones: Choice[] }) {
  const { form, state, pending, formProps, errorId } = useActionForm<ActionState, typeof settingsSchema>({
    schema: settingsSchema,
    action: settingsAction,
    initial: {},
    defaultValues: values as never,
    id: "settings",
  });
  const dirty = form.formState.isDirty;
  useEffect(() => {
    if (state.ok) form.reset(form.getValues());
  }, [state, form]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const e = form.formState.errors;
  const msg = (k: keyof SettingsValues) => e[k]?.message as string | undefined;
  return (
    <form {...formProps} aria-label="Change settings" className="grid gap-5">
      <FormError id={errorId} message={state.error} />
      <Field id="set-timezone" label="Time zone" help="Search by city, like London or Karachi." error={msg("timezone")}>
        {(a) => <RhfCombobox control={form.control} name="timezone" field={a} options={zones} searchLabel="Search time zones" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="set-quiet-start" label="Quiet from (hour, 0-23)" error={msg("quiet_start")}>
          {(a) => <Input {...a} type="number" min={0} max={23} inputMode="numeric" {...form.register("quiet_start")} />}
        </Field>
        <Field id="set-quiet-end" label="Quiet until (hour, 0-23)" error={msg("quiet_end")}>
          {(a) => <Input {...a} type="number" min={0} max={23} inputMode="numeric" {...form.register("quiet_end")} />}
        </Field>
      </div>
      <Field id="set-approval" label="Approvals" error={msg("approval_mode")}>
        {(a) => (
          <RhfSelect control={form.control} name="approval_mode" field={a} options={Object.entries(APPROVAL).map(([value, label]) => ({ value, label }))} />
        )}
      </Field>
      <Field id="set-promise" label="Promises from customers" error={msg("promise_acceptance")}>
        {(a) => (
          <RhfSelect control={form.control} name="promise_acceptance" field={a} options={Object.entries(PROMISE).map(([value, label]) => ({ value, label }))} />
        )}
      </Field>
      <Field
        id="set-budget"
        label={`Monthly budget for WhatsApp and SMS, in minor units of ${currency}`}
        help="0 blocks WhatsApp and SMS. Email is not limited."
        error={msg("budget")}
      >
        {(a) => <Input {...a} inputMode="numeric" className="tabular-nums" {...form.register("budget")} />}
      </Field>
      <Field id="set-bank" label="Bank details shown to customers (plain text)" error={msg("bank_instructions")}>
        {(a) => <Textarea {...a} maxLength={1000} rows={4} {...form.register("bank_instructions")} />}
      </Field>
      <Checkbox
        label="Let AI read payment proofs. When on, images customers send as proof are sent to the AI provider configured by the operator (Anthropic or OpenAI) to suggest amount and date. Suggestions are labelled untrusted and never confirm a payment. PDFs and duplicates are never sent. Off by default."
        {...form.register("proof_ai_extraction")}
      />
      <div
        className={cn(
          "flex flex-wrap items-center justify-end gap-3 rounded-xl border border-line bg-raised px-4 py-3 transition-shadow",
          dirty && "sticky bottom-4 z-(--z-sticky) shadow-elev-3",
        )}
      >
        <p className="mr-auto t-body-sm text-ink-muted" role="status">
          {dirty ? "Unsaved changes" : state.ok ? "Saved" : ""}
        </p>
        {dirty ? (
          <Button type="button" variant="ghost" onClick={() => form.reset(values)}>
            Discard
          </Button>
        ) : null}
        <Button type="submit" loading={pending}>
          Save settings
        </Button>
      </div>
      <FormSuccess message={state.ok ? undefined : state.message} />
    </form>
  );
}
