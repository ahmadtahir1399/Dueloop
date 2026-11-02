/**
 * The model's one-line summary from messages.analysis, as the inbound pipeline stores it (pipeline.ts). It is
 * attacker-influenced text: render it with AiText only. An opt-out keyword or a human-only setup has none.
 */
export function aiSummaryOf(analysis: unknown): string | null {
  if (!analysis || typeof analysis !== "object") return null;
  const summary = (analysis as { untrustedSummary?: unknown }).untrustedSummary;
  return typeof summary === "string" && summary.trim() !== "" ? summary : null;
}
