"use server";

import { isIanaZone } from "@dueloop/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/session";

export interface OnboardingState {
  error?: string;
}

const hour = z.coerce.number().int().min(0).max(23);
const schema = z.object({
  name: z.string().trim().min(1, { error: "Give the business a name." }),
  timezone: z.string().refine(isIanaZone, { error: "Pick a time zone from the list." }),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, { error: "Use a 3-letter currency code, e.g. PKR." }),
  quietStart: hour,
  quietEnd: hour,
});

export async function createBusiness(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const input = schema.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid input." };
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("create_tenant", {
    p_name: input.data.name,
    p_timezone: input.data.timezone,
    p_currency: input.data.currency,
    p_quiet_start_hour: input.data.quietStart,
    p_quiet_end_hour: input.data.quietEnd,
  });
  if (error) return { error: error.message };
  redirect("/");
}
