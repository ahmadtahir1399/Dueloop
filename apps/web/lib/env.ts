// Only NEXT_PUBLIC_ values are read here. The service-role / secret keys are never used by the web app
// (CLAUDE.md rule 12): every request runs as the signed-in user under Row Level Security.
export function publicEnv(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see README).");
  }
  return { url, publishableKey };
}
