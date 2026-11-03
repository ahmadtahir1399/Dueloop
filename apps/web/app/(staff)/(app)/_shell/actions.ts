"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireTenant, TENANT_COOKIE } from "@/lib/session";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

/** Switch the active tenant. Only a tenant the verified user belongs to is accepted; the cookie stays a hint. */
export async function switchTenant(formData: FormData): Promise<void> {
  const ctx = await requireTenant();
  const wanted = String(formData.get("tenant") ?? "");
  if (!ctx.tenants.some((t) => t.id === wanted)) redirect("/overview");
  (await cookies()).set(TENANT_COOKIE, wanted, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/overview");
}

/** Theme preference (§3.1.4): a UI-only cookie; never in the database. The server renders data-theme from it. */
export async function setTheme(formData: FormData): Promise<void> {
  const choice = parseTheme(String(formData.get("theme") ?? ""));
  const jar = await cookies();
  if (choice === "system") jar.delete(THEME_COOKIE);
  else jar.set(THEME_COOKIE, choice, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
}
