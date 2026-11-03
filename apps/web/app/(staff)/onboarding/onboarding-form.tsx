"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { RhfSelect, type Choice } from "@/components/ui/choice-select";
import { RhfCombobox } from "@/components/ui/combobox";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { onboardingSchema } from "@/forms/schemas";
import { useActionForm } from "@/lib/use-action-form";
import { createBusiness, type OnboardingState } from "./actions";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));

/**
 * S04 Onboarding (F04): one form, shown as two steps (Business · Time & money). Only the fields the existing
 * create_tenant call accepts (no country; CONFLICTS C-21). Without JavaScript both steps show and post together.
 */
export function OnboardingForm({ zones, currencies, defaultZone }: { zones: string[]; currencies: Choice[]; defaultZone: string }) {
  const [step, setStep] = useState(0);
  const { form, state, pending, formProps, errorId } = useActionForm<OnboardingState, typeof onboardingSchema>({
    schema: onboardingSchema,
    action: createBusiness,
    initial: {},
    defaultValues: { name: "", timezone: defaultZone, currency: "", quietStart: "20", quietEnd: "9" },
    id: "onboarding",
  });
  const e = form.formState.errors;
  const next = async () => {
    if (await form.trigger("name")) setStep(1);
  };
  return (
    <form {...formProps} className="grid gap-6" aria-label="Set up your business">
      <Stepper steps={["Business", "Time and money"]} current={step} label="Setup steps" />
      <FormError id={errorId} message={state.error} />
      <div className={step === 0 ? "step-enter grid gap-4" : "hidden"}>
        <Field id="name" label="Business name" help="Customers see this name on reminders and the pay page." error={e.name?.message as string | undefined}>
          {(a) => <Input {...a} autoComplete="organization" {...form.register("name")} />}
        </Field>
        <Button type="button" onClick={() => void next()} className="w-full sm:w-fit sm:justify-self-end">
          Continue
        </Button>
      </div>
      <div className={step === 1 ? "step-enter grid gap-4" : "hidden"}>
        <Field id="timezone" label="Time zone" error={e.timezone?.message as string | undefined}>
          {(a) => (
            <RhfCombobox control={form.control} name="timezone" field={a} options={zones.map((z) => ({ value: z, label: z }))} searchLabel="Search time zones" />
          )}
        </Field>
        <Field id="currency" label="Main currency" help="Search by code or name, like PKR or rupee." error={e.currency?.message as string | undefined}>
          {(a) => <RhfCombobox control={form.control} name="currency" field={a} options={currencies} placeholder="Choose a currency" searchLabel="Search currencies" />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="quietStart" label="No messages from" error={e.quietStart?.message as string | undefined}>
            {(a) => (
              <RhfSelect control={form.control} name="quietStart" field={a} options={HOUR_OPTIONS} />
            )}
          </Field>
          <Field id="quietEnd" label="until" error={e.quietEnd?.message as string | undefined}>
            {(a) => (
              <RhfSelect control={form.control} name="quietEnd" field={a} options={HOUR_OPTIONS} />
            )}
          </Field>
        </div>
        <p className="t-caption text-ink-muted">Quiet hours are in the business&apos;s local time. Choose the same hour twice for no quiet hours.</p>
        <Banner tone="info">No reminder can go out until a sender address is set. You can add it in Settings › Integrations after this step.</Banner>
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => setStep(0)}>
            Back
          </Button>
          <Button type="submit" loading={pending} loadingLabel="Creating…">
            Create business
          </Button>
        </div>
      </div>
    </form>
  );
}
