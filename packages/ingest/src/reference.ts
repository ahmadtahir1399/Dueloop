// Reference codes customers quote on a bank transfer: short, typeable, with a check character.
import type { RandomInt } from './types.ts';

/** 30 symbols: digits 2-9 and A-Z without I, L, O, U (no 0/O, 1/I/L confusion, no accidental words with U). */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const REFERENCE_BODY_LENGTH = 7;
const N = REFERENCE_ALPHABET.length;

/** Luhn mod N check character: catches every single-character typo and most adjacent swaps. */
function checkChar(body: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    let addend = factor * REFERENCE_ALPHABET.indexOf(body[i] ?? '');
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / N) + (addend % N);
    sum += addend;
  }
  return REFERENCE_ALPHABET[(N - (sum % N)) % N] ?? '';
}

/** 7 random symbols + 1 check symbol, e.g. "K7QH2MXD". Pure: randomness is injected. */
export function generateReferenceCode(random: RandomInt): string {
  let body = '';
  for (let i = 0; i < REFERENCE_BODY_LENGTH; i++) body += REFERENCE_ALPHABET[random(N)] ?? '';
  return body + checkChar(body);
}

/** Normalises what a person typed: upper-case, spaces and dashes removed. */
export function normaliseReferenceCode(text: string): string {
  return text.toUpperCase().replace(/[\s-]/g, '');
}

export function isValidReferenceCode(text: string): boolean {
  const code = normaliseReferenceCode(text);
  if (code.length !== REFERENCE_BODY_LENGTH + 1 || [...code].some((c) => !REFERENCE_ALPHABET.includes(c))) return false;
  return checkChar(code.slice(0, -1)) === code.slice(-1);
}
