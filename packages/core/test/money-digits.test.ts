import { describe, expect, it } from 'vitest';
import { digitsToMajorString, toMajorString } from '../src/index.ts';

describe('digitsToMajorString (bigint-safe display, prompt 6 issue I)', () => {
  it('agrees with toMajorString on safe integers', () => {
    for (const [minor, cur] of [[0, 'GBP'], [5, 'GBP'], [125050, 'EUR'], [12345, 'KWD'], [999, 'JPY'], [1, 'CLF']] as const) {
      expect(digitsToMajorString(String(minor), cur)).toEqual(toMajorString({ minor, currency: cur }));
    }
  });

  it('keeps every digit beyond 2^53', () => {
    expect(digitsToMajorString('9007199254740993', 'USD')).toEqual({ ok: true, value: '90071992547409.93' });
    expect(digitsToMajorString('9223372036854775807', 'JPY')).toEqual({ ok: true, value: '9223372036854775807' });
  });

  it('rejects anything that is not plain digits, and unknown currencies', () => {
    for (const bad of ['', '-1', '1.5', '1e21', ' 12', '0x10']) expect(digitsToMajorString(bad, 'USD').ok).toBe(false);
    expect(digitsToMajorString('100', 'XXZ')).toEqual({ ok: false, error: 'unknown_currency' });
  });

  it('drops leading zeros', () => {
    expect(digitsToMajorString('0005', 'GBP')).toEqual({ ok: true, value: '0.05' });
  });
});
