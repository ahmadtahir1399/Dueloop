import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/auth/auth-frame";
import { SignUpForm } from "../sign-in/login-form";

export const metadata: Metadata = { title: "Create an account · Dueloop" };

/** S02 Sign up (same server action as before). No legal line: no terms pages exist (Q2). */
export default function SignUpPage() {
  return (
    <AuthFrame>
      <div className="grid gap-1">
        <h1 className="t-display-xl text-ink">Create an account</h1>
        <p className="t-body-md text-ink-muted">You set up your business next. You can invite your team later.</p>
      </div>
      <SignUpForm />
      <p className="t-body-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-link underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
