import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  add,
  assertSameCurrency,
  compare,
  currencyExponent,
  money,
  parseMajor,
  splitInstalments,
  subtract,
  toMajorString,
  type Money,
} from '../src/money.ts';

const m = (minor: number, currency: string): Money => ({ minor, currency });

describe('currencyExponent (ISO 4217, not hardcoded to 2)', () => {
  it.each([
    ['JPY', 0],
    ['USD', 2],
    ['KWD', 3],
    ['BHD', 3],
    ['CLF', 4],
    // These differ in Intl/CLDR (display digits 0) but ISO 4217 says 2.
    ['PKR', 2],
    ['IDR', 2],
    ['HUF', 2],
  ])('%s has %d minor digits', (code, exp) => {
    expect(currencyExponent(code)).toEqual({ ok: true, value: exp });
  });

  it.each(['XYZ', 'usd', '', 'XAU', 'toString', '__proto__'])('rejects %j', (code) => {
    expect(currencyExponent(code)).toEqual({ ok: false, error: 'unknown_currency' });
  });
});

describe('money()', () => {
  it('accepts non-negative safe integers', () => {
    expect(money(0, 'JPY')).toEqual({ ok: true, value: m(0, 'JPY') });
    expect(money(Number.MAX_SAFE_INTEGER, 'USD').ok).toBe(true);
  });
  it.each([
    [1.5, 'not_safe_integer'],
    [Number.NaN, 'not_safe_integer'],
    [Number.MAX_SAFE_INTEGER + 1, 'not_safe_integer'],
    [-1, 'negative'],
  ])('rejects %d', (minor, error) => {
    expect(money(minor, 'USD')).toEqual({ ok: false, error });
  });
});

describe('arithmetic', () => {
  it('adds and subtracts in minor units', () => {
    expect(add(m(1250, 'USD'), m(1, 'USD'))).toEqual({ ok: true, value: m(1251, 'USD') });
    expect(subtract(m(12345, 'KWD'), m(345, 'KWD'))).toEqual({ ok: true, value: m(12000, 'KWD') });
    expect(subtract(m(500, 'JPY'), m(500, 'JPY'))).toEqual({ ok: true, value: m(0, 'JPY') });
  });
  it('never subtracts below zero', () => {
    expect(subtract(m(1, 'USD'), m(2, 'USD'))).toEqual({ ok: false, error: 'negative' });
  });
  it('detects overflow', () => {
    expect(add(m(Number.MAX_SAFE_INTEGER, 'USD'), m(1, 'USD'))).toEqual({ ok: false, error: 'overflow' });
  });
  it('refuses to mix currencies', () => {
    expect(assertSameCurrency(m(1, 'USD'), m(1, 'JPY'))).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(add(m(1, 'USD'), m(1, 'JPY'))).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(subtract(m(1, 'USD'), m(1, 'JPY'))).toEqual({ ok: false, error: 'currency_mismatch' });
    expect(compare(m(1, 'USD'), m(1, 'JPY'))).toEqual({ ok: false, error: 'currency_mismatch' });
  });
  it('compares', () => {
    expect(compare(m(1, 'KWD'), m(2, 'KWD'))).toEqual({ ok: true, value: -1 });
    expect(compare(m(2, 'KWD'), m(2, 'KWD'))).toEqual({ ok: true, value: 0 });
    expect(compare(m(3, 'KWD'), m(2, 'KWD'))).toEqual({ ok: true, value: 1 });
  });
});

describe('major-unit strings (edge formatting, no floats)', () => {
  it.each([
    [m(125000, 'JPY'), '125000'],
    [m(125000, 'USD'), '1250.00'],
    [m(5, 'USD'), '0.05'],
    [m(12345, 'KWD'), '12.345'],
    [m(7, 'KWD'), '0.007'],
    [m(0, 'KWD'), '0.000'],
  ])('%o -> %s', (value, text) => {
    expect(toMajorString(value)).toEqual({ ok: true, value: text });
    expect(parseMajor(text, value.currency)).toEqual({ ok: true, value });
  });
  it('parses fewer decimals than the exponent', () => {
    expect(parseMajor('12.3', 'KWD')).toEqual({ ok: true, value: m(12300, 'KWD') });
  });
  it.each([
    ['1.5', 'JPY'],
    ['1.234', 'USD'],
    ['-1', 'USD'],
    ['1,000', 'USD'],
    ['1e3', 'USD'],
    ['', 'USD'],
  ])('rejects %j for %s', (text, cur) => {
    expect(parseMajor(text, cur)).toEqual({ ok: false, error: 'invalid_format' });
  });
});

describe('splitInstalments', () => {
  it('gives the remainder to the first parts', () => {
    const r = splitInstalments(m(1000, 'USD'), 3);
    expect(r).toEqual({ ok: true, value: [m(334, 'USD'), m(333, 'USD'), m(333, 'USD')] });
  });
  it('splits JPY with no fractional unit to lose', () => {
    expect(splitInstalments(m(10, 'JPY'), 4)).toEqual({ ok: true, value: [m(3, 'JPY'), m(3, 'JPY'), m(2, 'JPY'), m(2, 'JPY')] });
  });
  it('yields zero parts when n exceeds the total', () => {
    expect(splitInstalments(m(2, 'KWD'), 3)).toEqual({ ok: true, value: [m(1, 'KWD'), m(1, 'KWD'), m(0, 'KWD')] });
  });
  it.each([0, -1, 1.5, Number.NaN])('rejects n = %d', (n) => {
    expect(splitInstalments(m(100, 'USD'), n)).toEqual({ ok: false, error: 'invalid_count' });
  });

  it('property: parts sum exactly to total, are non-increasing and differ by <= 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 1, max: 500 }),
        fc.constantFrom('JPY', 'USD', 'KWD'),
        (minor, n, currency) => {
          const r = splitInstalments(m(minor, currency), n);
          if (!r.ok) return false;
          const parts = r.value.map((p) => p.minor);
          const sum = parts.reduce((s, p) => s + BigInt(p), 0n);
          const max = Math.max(...parts);
          const min = Math.min(...parts);
          return (
            r.value.length === n &&
            sum === BigInt(minor) &&
            parts.every((p, i) => Number.isSafeInteger(p) && p >= 0 && (i === 0 || p <= (parts[i - 1] ?? p))) &&
            max - min <= 1 &&
            r.value.every((p) => p.currency === currency)
          );
        },
      ),
    );
  });

  it('property: same input gives the same split (deterministic)', () => {
    fc.assert(
      fc.property(fc.nat(), fc.integer({ min: 1, max: 50 }), (minor, n) => {
        expect(splitInstalments(m(minor, 'USD'), n)).toEqual(splitInstalments(m(minor, 'USD'), n));
      }),
    );
  });
});
