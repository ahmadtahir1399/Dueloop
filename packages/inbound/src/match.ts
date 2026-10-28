// Invoice matching (pipeline step 6b). Never guess (rule 24): a thread reference to OUR message, else
// exactly one candidate, else a human task listing the candidates.

/** How many days back an outbound reminder makes an invoice a candidate for an unthreaded reply. */
export const MATCH_WINDOW_DAYS = 30;

export interface MatchCandidate {
  readonly invoiceId: string;
  readonly number: string;
  readonly status: string;
  readonly lastOutboundAt: Date | null;
}

export type MatchResult =
  | { readonly kind: 'matched'; readonly by: 'thread' | 'context_id' | 'single_open_invoice'; readonly invoiceIds: readonly string[]; readonly threadMessageId: string | null }
  | { readonly kind: 'none'; readonly candidates: readonly MatchCandidate[] };

export interface MatchInput {
  readonly channel: 'email' | 'whatsapp';
  /** Outbound messages of ours that the reply's thread ids point at (In-Reply-To/References or context.id). */
  readonly threadHits: readonly { readonly messageId: string; readonly invoiceIds: readonly string[] }[];
  /** The customer's non-final invoices. */
  readonly openInvoices: readonly MatchCandidate[];
  readonly now: Date;
}

export function matchInvoices(i: MatchInput): MatchResult {
  const hit = i.threadHits.find((h) => h.invoiceIds.length > 0);
  if (hit) return { kind: 'matched', by: i.channel === 'email' ? 'thread' : 'context_id', invoiceIds: [...hit.invoiceIds], threadMessageId: hit.messageId };
  const windowStart = i.now.getTime() - MATCH_WINDOW_DAYS * 86_400_000;
  const recent = i.openInvoices.filter((c) => c.lastOutboundAt !== null && c.lastOutboundAt.getTime() >= windowStart);
  if (recent.length === 1 && recent[0]) return { kind: 'matched', by: 'single_open_invoice', invoiceIds: [recent[0].invoiceId], threadMessageId: null };
  return { kind: 'none', candidates: recent.length > 0 ? recent : i.openInvoices };
}
