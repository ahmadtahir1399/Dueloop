"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  message?: string;
}

const credentials = z.object({
  email: z.email({ error: "Enter a valid email address." }),
  password: z.string().min(8, { error: "The password needs at least 8 characters." }),
});

function parse(formData: FormData) {
  return credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const input = parse(formData);
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(input.data);
  if (error) return { error: error.message };
  redirect("/");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const input = parse(formData);
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid input." };
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const { data, error } = await supabase.auth.signUp({
    ...input.data,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=/onboarding` },
  });
  if (error) return { error: error.message };
  // With email confirmation on (the hosted default) there is no session until the link is clicked.
  if (!data.session) return { message: "Check your inbox and follow the link to confirm your email." };
  redirect("/onboarding");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
