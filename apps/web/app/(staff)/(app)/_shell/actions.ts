"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireTenant, TENANT_COOKIE } from "@/lib/session";

/** Switch the active tenant. Only a tenant the verified user belongs to is accepted; the cookie stays a hint. */
export async function switchTenant(formData: FormData): Promise<void> {
  const ctx = await requireTenant();
  const wanted = String(formData.get("tenant") ?? "");
  if (!ctx.tenants.some((t) => t.id === wanted)) redirect("/");
  (await cookies()).set(TENANT_COOKIE, wanted, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}
