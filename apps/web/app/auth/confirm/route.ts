// Email confirmation link handler (Supabase password auth docs, PKCE flow token exchange).
import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Only same-site relative paths, so the link cannot be used as an open redirect. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  const code = searchParams.get("code");
  const supabase = await createClient();

  // Custom email template (docs): ?token_hash=...&type=email
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect(next);
  }
  // Default template with the SSR client's PKCE flow: the link comes back with ?code=...
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
  }
  redirect("/auth/auth-code-error");
}
