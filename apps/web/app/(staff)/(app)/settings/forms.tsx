"use client";

import { Button } from "@/components/ui/button";
import { CodeValue } from "@/components/ui/code-value";
import { RhfSelect } from "@/components/ui/choice-select";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FormError, FormSuccess } from "@/components/ui/field";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "accountant", label: "Accountant" },
  { value: "collector", label: "Collector" },
];
import { Input } from "@/components/ui/input";
import { apiKeySchema, holidaySchema, inviteSchema } from "@/forms/schemas";
import type { ActionState } from "@/lib/actions";
import { useActionForm } from "@/lib/use-action-form";
import { apiKeyAction, holidayAction, memberAction, type KeyState } from "./admin-actions";

/** F14c Add a holiday. */
export function HolidayForm() {
  const { form, state, pending, formProps, errorId } = useActionForm<ActionState, typeof holidaySchema>({
    schema: holidaySchema,
    action: holidayAction,
    initial: {},
    defaultValues: { date: "", label: "" },
    id: "holiday",
  });
  const e = form.formState.errors;
  return (
    <form {...formProps} aria-label="Add a holiday" className="grid gap-3">
      <FormError id={errorId} message={state.error} />
      <div className="flex flex-wrap items-end gap-3">
        <Field id="holiday-date" label="Date" error={e.date?.message as string | undefined}>
          {(a) => <DatePicker {...a} {...form.register("date")} />}
        </Field>
        <Field id="holiday-label" label="Label" error={e.label?.message as string | undefined}>
          {(a) => <Input {...a} maxLength={80} {...form.register("label")} />}
        </Field>
        <Button type="submit" name="op" value="add" loading={pending}>
          Add
        </Button>
      </div>
      <FormSuccess message={state.message} />
    </form>
  );
}

/** F15 Invite member (owner). */
export function InviteForm() {
  const { form, state, pending, formProps, errorId } = useActionForm<ActionState, typeof inviteSchema>({
    schema: inviteSchema,
    action: memberAction,
    initial: {},
    defaultValues: { email: "", role: "collector" },
    id: "invite",
  });
  const e = form.formState.errors;
  return (
    <form {...formProps} aria-label="Invite a member" className="grid gap-3">
      <input type="hidden" name="op" value="invite" />
      <FormError id={errorId} message={state.error} />
      <div className="flex flex-wrap items-end gap-3">
        <Field id="invite-email" label="Email" error={e.email?.message as string | undefined}>
          {(a) => <Input {...a} type="email" maxLength={254} className="w-72" {...form.register("email")} />}
        </Field>
        <Field id="invite-role" label="Role" error={e.role?.message as string | undefined}>
          {(a) => (
            <RhfSelect control={form.control} name="role" field={a} className="w-44" options={ROLE_OPTIONS} />
          )}
        </Field>
        <Button type="submit" loading={pending}>
          Invite
        </Button>
      </div>
      <FormSuccess message={state.message} />
    </form>
  );
}

/** F17 Create API key: the full key is shown once, with a copy button. */
export function ApiKeyForm() {
  const { form, state, pending, formProps, errorId } = useActionForm<KeyState, typeof apiKeySchema>({
    schema: apiKeySchema,
    action: apiKeyAction,
    initial: {},
    defaultValues: { name: "" },
    id: "api-key",
  });
  return (
    <form {...formProps} aria-label="Create an API key" className="grid gap-3">
      <FormError id={errorId} message={state.error} />
      <div className="flex flex-wrap items-end gap-3">
        <Field id="key-name" label="Name" error={form.formState.errors.name?.message as string | undefined}>
          {(a) => <Input {...a} maxLength={80} className="w-72" {...form.register("name")} />}
        </Field>
        <Button type="submit" name="op" value="create" loading={pending}>
          Create key
        </Button>
      </div>
      <FormSuccess message={state.message} />
      {state.secret ? (
        <div className="grid gap-2 rounded-lg border border-warning-line bg-warning-soft p-4 t-body-sm text-warning-ink" data-testid="secret-once">
          <p className="font-semibold">Shown once. Copy it now: you won&apos;t see this again.</p>
          <CodeValue value={state.secret} label="API key" className="bg-panel text-ink" />
        </div>
      ) : null}
    </form>
  );
}
