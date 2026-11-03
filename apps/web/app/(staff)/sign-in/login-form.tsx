"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signInSchema, signUpSchema } from "@/forms/schemas";
import { useActionForm } from "@/lib/use-action-form";
import { signIn, signUp, type AuthState } from "./actions";

function PasswordInput({ show, ...props }: React.ComponentProps<"input"> & { show: boolean }) {
  return <Input type={show ? "text" : "password"} className="pr-20" {...props} />;
}

function ShowToggle({ show, onToggle, controls }: { show: boolean; onToggle: () => void; controls: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-controls={controls}
      aria-pressed={show}
      className="absolute top-1/2 right-1 inline-flex min-h-9 -translate-y-1/2 items-center rounded-sm px-3 t-body-sm font-medium text-link hover:bg-brand-soft"
    >
      {show ? "Hide" : "Show"}
      <span className="sr-only"> password</span>
    </button>
  );
}

/** F01 Sign in. */
export function SignInForm() {
  const [show, setShow] = useState(false);
  const { form, state, pending, formProps, errorId } = useActionForm<AuthState, typeof signInSchema>({
    schema: signInSchema,
    action: signIn,
    initial: {},
    defaultValues: { email: "", password: "" },
    id: "sign-in",
  });
  const err = form.formState.errors;
  return (
    <form {...formProps} aria-label="Sign in" className="grid gap-4">
      <FormError id={errorId} message={state.error} />
      <Field id="sign-in-email" label="Email" error={err.email?.message as string | undefined}>
        {(a) => <Input {...a} type="email" autoComplete="email" {...form.register("email")} />}
      </Field>
      <Field id="sign-in-password" label="Password" error={err.password?.message as string | undefined}>
        {(a) => (
          <div className="relative">
            <PasswordInput {...a} show={show} autoComplete="current-password" {...form.register("password")} />
            <ShowToggle show={show} onToggle={() => setShow((s) => !s)} controls={a.id} />
          </div>
        )}
      </Field>
      <Button type="submit" loading={pending} loadingLabel="Signing in…" className="w-full">
        Sign in
      </Button>
    </form>
  );
}

/** F02 Sign up. confirmPassword is UI-only; the server action reads email and password as before. */
export function SignUpForm() {
  const [show, setShow] = useState(false);
  const { form, state, pending, formProps, errorId } = useActionForm<AuthState, typeof signUpSchema>({
    schema: signUpSchema,
    action: signUp,
    initial: {},
    defaultValues: { email: "", password: "", confirmPassword: "" },
    id: "sign-up",
  });
  const err = form.formState.errors;
  if (state.message) {
    // S03: the server sent a confirmation link (no resend endpoint exists, CONFLICTS C-21).
    return (
      <div role="status" className="grid gap-3 rounded-xl border border-line bg-panel p-6">
        <h2 className="t-heading-md text-ink">Check your inbox</h2>
        <p className="t-body-md text-ink-muted">{state.message}</p>
        <p className="t-body-sm text-ink-muted">
          Wrong address?{" "}
          <a href="/sign-up" className="font-medium text-link underline">
            Sign up again
          </a>
        </p>
      </div>
    );
  }
  return (
    <form {...formProps} aria-label="Create account" className="grid gap-4">
      <FormError id={errorId} message={state.error} />
      <Field id="sign-up-email" label="Email" error={err.email?.message as string | undefined}>
        {(a) => <Input {...a} type="email" autoComplete="email" {...form.register("email")} />}
      </Field>
      <Field id="sign-up-password" label="Password" help="Use at least 8 characters." error={err.password?.message as string | undefined}>
        {(a) => (
          <div className="relative">
            <PasswordInput {...a} show={show} autoComplete="new-password" minLength={8} {...form.register("password")} />
            <ShowToggle show={show} onToggle={() => setShow((s) => !s)} controls={a.id} />
          </div>
        )}
      </Field>
      <Field id="sign-up-confirm" label="Confirm password" error={err.confirmPassword?.message as string | undefined}>
        {(a) => <PasswordInput {...a} show={show} autoComplete="new-password" {...form.register("confirmPassword")} />}
      </Field>
      <Button type="submit" loading={pending} loadingLabel="Creating account…" className="w-full">
        Create account
      </Button>
    </form>
  );
}
