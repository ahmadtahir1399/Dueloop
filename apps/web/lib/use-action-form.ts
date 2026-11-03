"use client";

// React Hook Form + Zod on top of the EXISTING server actions (redesign §5, CONFLICTS C-23).
// - The <form> keeps action={formAction}, so without JavaScript it still posts natively and the server action
//   validates as before (no contract change, D10).
// - With JavaScript, RHF validates first (onTouched, then live while correcting, §5.5); only a valid form is sent,
//   as the same FormData (including the clicked submit button's name/value) to the same action.
// - Field names in the schema ARE the FormData names the action reads; test/forms.test.ts locks that.
import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";

export interface ActionFormResult<S> {
  form: UseFormReturn<FieldValues>;
  state: S;
  pending: boolean;
  formProps: {
    ref: React.RefObject<HTMLFormElement | null>;
    action: (fd: FormData) => void;
    onSubmit: (e: FormEvent<HTMLFormElement>) => void;
    noValidate: true;
  };
  /** id of the form-level error banner; it receives focus when the server refuses. */
  errorId: string;
}

export function useActionForm<S extends { error?: string }, Schema extends z.ZodType<FieldValues, FieldValues>>(opts: {
  schema: Schema;
  action: (prev: S, fd: FormData) => Promise<S>;
  initial: S;
  defaultValues?: DefaultValues<z.input<Schema>>;
  id: string;
}): ActionFormResult<S> {
  const [state, formAction, pending] = useActionState<S, FormData>(
    opts.action as unknown as (prev: Awaited<S>, fd: FormData) => Promise<S>,
    opts.initial as unknown as Awaited<S>,
  );
  const ref = useRef<HTMLFormElement | null>(null);
  const form = useForm<FieldValues>({
    resolver: zodResolver(opts.schema as never),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: opts.defaultValues as DefaultValues<FieldValues> | undefined,
    shouldFocusError: true,
  });
  const errorId = `${opts.id}-error`;
  useEffect(() => {
    if (state.error) document.getElementById(errorId)?.focus();
  }, [state, errorId]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    void form.handleSubmit(() => {
      const el = ref.current;
      if (!el) return;
      const fd = submitter && "name" in submitter ? new FormData(el, submitter) : new FormData(el);
      startTransition(() => formAction(fd));
    })(e);
  };
  return { form, state: state as S, pending, formProps: { ref, action: formAction, onSubmit, noValidate: true }, errorId };
}
