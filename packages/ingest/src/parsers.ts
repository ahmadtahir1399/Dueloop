// Pure parsers without the staging/commit code (and its supabase-js types), for reuse by the inbound
// processor: amounts stated in replies and sender email/phone normalisation (prompt 4); dates, amounts and
// reference codes for payment recording and the bank adapter (prompt 5).
export { parseAmount, type AmountResult } from './amount.ts';
export { normaliseEmail, normalisePhone } from './contact.ts';
export { parseDate } from './date.ts';
export { generateReferenceCode, isValidReferenceCode, normaliseReferenceCode } from './reference.ts';
