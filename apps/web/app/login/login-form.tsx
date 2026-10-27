"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp, type AuthState } from "./actions";

export function LoginForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "sign-in" ? signIn : signUp, {});
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${mode}-email`}>Email</Label>
        <Input id={`${mode}-email`} name="email" type="email" autoComplete="email" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${mode}-password`}>Password</Label>
        <Input
          id={`${mode}-password`}
          name="password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.message ? (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
