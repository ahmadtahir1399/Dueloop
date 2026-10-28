// Pre-filters (pipeline step 6): decided by code, no model call, recorded on the message.
import type { NormalisedMessage } from './types.ts';

export type Prefilter = 'bounce' | 'auto_reply' | 'delivery_receipt' | 'own_address' | 'empty' | 'opt_out_keyword' | 'none';

/**
 * Opt-out keyword DATA per language. Matched only on SHORT messages (the whole message is the request), so
 * "don't stop sending me invoices" inside a long reply goes to the model instead.
 */
export const OPT_OUT_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  en: ['stop', 'unsubscribe', 'stop all', 'opt out', 'optout', 'stop messaging me', 'stop calling me', 'stop texting me', 'remove me', 'do not contact me', "don't contact me", 'no more messages', 'stop sending messages'],
  de: ['stopp', 'stop', 'abmelden', 'abbestellen', 'keine nachrichten mehr', 'nicht mehr kontaktieren', 'austragen'],
  es: ['baja', 'parar', 'alto', 'cancelar', 'darme de baja', 'no me escriban', 'no me contacten', 'dejen de escribirme'],
  fr: ['stop', 'arrêt', 'desabonner', 'désabonner', 'ne plus me contacter'],
};
const ALL_KEYWORDS = new Set(Object.values(OPT_OUT_KEYWORDS).flat());
/** A short message is at most this many words. */
export const OPT_OUT_MAX_WORDS = 5;
const NEGATION = /\b(don'?t|do not|never|nicht|no)\s+stop\b/i;

const normaliseWords = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function isOptOutKeyword(text: string): boolean {
  const t = normaliseWords(text);
  if (t === '' || t.split(' ').length > OPT_OUT_MAX_WORDS || NEGATION.test(t)) return false;
  if (ALL_KEYWORDS.has(t)) return true;
  // "STOP please", "stop thanks", "please unsubscribe": a keyword plus politeness only.
  const polite = new Set(['please', 'pls', 'thanks', 'thank you', 'bitte', 'danke', 'por favor', 'gracias', 'merci', 'now', 'immediately']);
  const words = t.split(' ').filter((w) => !polite.has(w));
  return ALL_KEYWORDS.has(words.join(' '));
}

/** RFC 3834: any Auto-Submitted value other than "no"; plus Precedence and vendor autoresponder headers. */
export function isAutoReply(m: NormalisedMessage): boolean {
  if (m.autoSubmitted !== null && m.autoSubmitted !== 'no') return true;
  if (m.precedence !== null && ['bulk', 'junk', 'list', 'auto_reply'].includes(m.precedence)) return true;
  if (m.autoReplyHeader) return true;
  return /^(auto(matic)?[\s:-]*(reply|response|antwort)|out of (the )?office|abwesenheit|fuera de la oficina|r[ée]ponse automatique)/i.test(m.subject ?? '');
}

export function prefilter(m: NormalisedMessage, ownAddresses: readonly string[]): Prefilter {
  if (m.report) return m.report.action === 'delivered' || m.report.action === 'relayed' ? 'delivery_receipt' : 'bounce';
  if (m.channel === 'email' && /^(mailer-daemon|postmaster)@/i.test(m.from)) return 'bounce';
  if (ownAddresses.map((a) => a.toLowerCase()).includes(m.from.toLowerCase())) return 'own_address';
  if (isAutoReply(m)) return 'auto_reply';
  if (m.newText.trim() === '' && m.attachments.length === 0) return 'empty';
  if (isOptOutKeyword(m.newText)) return 'opt_out_keyword';
  return 'none';
}
