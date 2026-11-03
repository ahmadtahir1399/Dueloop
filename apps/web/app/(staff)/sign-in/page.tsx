import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/auth/auth-frame";
import { SignInForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Dueloop" };

/** S01 Sign in. No "Forgot?" link: there is no reset route (Q1). */
export default function SignInPage() {
  return (
    <AuthFrame>
      <div className="grid gap-1">
        <h1 className="t-display-xl text-ink">Welcome back</h1>
        <p className="t-body-md text-ink-muted">Sign in to see what needs you today.</p>
      </div>
      <SignInForm />
      <p className="t-body-sm text-ink-muted">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-link underline">
          Create an account
        </Link>
      </p>
    </AuthFrame>
  );
}
