// Pure parsers without the staging/commit code (and its supabase-js types), for reuse by the inbound
// processor: amounts stated in replies and sender email/phone normalisation (prompt 4).
export { parseAmount, type AmountResult } from './amount.ts';
export { normaliseEmail, normalisePhone } from './contact.ts';
