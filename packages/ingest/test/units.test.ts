import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAmount } from '../src/amount.ts';
import { normaliseEmail, normalisePhone } from '../src/contact.ts';
import { decodeUtf8, detectDelimiter, parseCsv } from '../src/csv.ts';
import { parseDate } from '../src/date.ts';
import { generateReferenceCode, isValidReferenceCode, normaliseReferenceCode, REFERENCE_ALPHABET } from '../src/reference.ts';
import { neutraliseCell } from '../src/report.ts';
import { seeded } from './random.ts';

const amt = (text: string, decimal: '.' | ',' = '.', currency = 'USD') => parseAmount(text, decimal, (c) => c ?? currency);

describe('parseAmount (integer minor units, never floats)', () => {
  it.each([
    ['$1,250.00', '.', 'USD', 125000],
    ['1.250,00 EUR', ',', 'USD', 125000],
    ['1 250,00', ',', 'EUR', 125000],
    ['1\u00A0250,00', ',', 'EUR', 125000],
    ['1250', '.', 'USD', 125000],
    ['1,250', '.', 'USD', 125000],
    ["1'250.50", '.', 'CHF', 125050],
    ['PKR 1,00,000', '.', 'USD', 10000000],
    ['12,34,567.89', '.', 'INR', 123456789],
    ['¥125,000', '.', 'JPY', 125000],
    ['KWD 12.345', '.', 'USD', 12345],
    ['0.01', '.', 'USD', 1],
  ] as const)('%s (decimal %s, default %s) -> %d', (text, dec, cur, minor) => {
    const r = amt(text, dec, cur);
    expect(r.ok && r.minor).toBe(minor);
  });

  it('reports a currency code found in the cell', () => {
    expect(amt('1.250,00 EUR', ',')).toEqual({ ok: true, minor: 125000, currencyInCell: 'EUR' });
    expect(amt('PKR 1,00,000')).toEqual({ ok: true, minor: 10000000, currencyInCell: 'PKR' });
  });

  it.each([
    ['0', 'non_positive_amount'],
    ['0.00', 'non_positive_amount'],
    ['-100', 'non_positive_amount'],
    ['100-', 'non_positive_amount'],
    ['(100)', 'non_positive_amount'],
    ['', 'missing_value'],
    ['abc', 'invalid_amount'],
    ['1,25', 'invalid_amount'], // not a valid grouping under decimal '.'
    ['1.2.3', 'invalid_amount'],
    ['1,250.00.00', 'invalid_amount'],
    ['12,3456', 'invalid_amount'],
    ['1.234', 'excess_decimals'], // USD has 2
    ['99999999999999999', 'amount_too_large'],
    ['100 XYZ', 'unknown_currency'],
  ])('%j -> %s', (text, code) => {
    const r = amt(text);
    expect(r.ok ? 'ok' : r.issue.code).toBe(code);
  });

  it('JPY has no minor unit: any decimals are an error', () => {
    const r = parseAmount('1250.00', '.', () => 'JPY');
    expect(r.ok ? 'ok' : r.issue.code).toBe('excess_decimals');
  });

  it('KWD has 3 decimals: 4 is an error, 3 is fine', () => {
    expect(parseAmount('1.2345', '.', () => 'KWD').ok).toBe(false);
    expect(parseAmount('1.234', '.', () => 'KWD')).toEqual({ ok: true, minor: 1234, currencyInCell: null });
  });

  it('decimal comma style reads "1,250" as 1.250 (an error for USD), never silently as 1250', () => {
    const r = amt('1,250', ',');
    expect(r.ok ? 'ok' : r.issue.code).toBe('excess_decimals');
  });

  it('property: formatting n minor units as d.dd and parsing it back is exact', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 ** 13 }), (n) => {
        const s = `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
        const r = amt(s);
        return r.ok && r.minor === n;
      }),
    );
  });
});

describe('parseDate (explicit format, never inferred)', () => {
  it('03/04/2026 is 3 April under DMY and 4 March under MDY', () => {
    expect(parseDate('03/04/2026', 'DMY')).toMatchObject({ ok: true, iso: '2026-04-03', confirmsFormat: false });
    expect(parseDate('03/04/2026', 'MDY')).toMatchObject({ ok: true, iso: '2026-03-04', confirmsFormat: false });
  });
  it.each([
    ['25.12.2026', 'DMY', '2026-12-25'],
    ['12/25/2026', 'MDY', '2026-12-25'],
    ['2026-12-25', 'YMD', '2026-12-25'],
    ['25-12-26', 'DMY', '2026-12-25'],
    ['1/2/26', 'MDY', '2026-01-02'],
    ['29/02/2028', 'DMY', '2028-02-29'],
  ] as const)('%s (%s) -> %s', (text, f, iso) => {
    expect(parseDate(text, f)).toMatchObject({ ok: true, iso });
  });
  it.each([
    ['31/02/2026', 'DMY'],
    ['29/02/2027', 'DMY'],
    ['13/13/2026', 'DMY'],
    ['2026-12-25', 'DMY'],
    ['25/12/226', 'DMY'],
    ['next tuesday', 'DMY'],
    ['123', 'DMY'],
  ] as const)('%s (%s) is an error', (text, f) => {
    expect(parseDate(text, f).ok).toBe(false);
  });
  it('Excel serials use the 1900 system (1899-12-30 + n): 46113 is 2026-04-01, 45658 is 2025-01-01', () => {
    expect(parseDate('46113', 'DMY')).toMatchObject({ ok: true, iso: '2026-04-01', excelSerial: true });
    expect(parseDate('45658', 'MDY')).toMatchObject({ ok: true, iso: '2025-01-01', excelSerial: true });
    expect(parseDate('19999', 'DMY').ok).toBe(false);
    expect(parseDate('80001', 'DMY').ok).toBe(false);
  });
});

describe('decodeUtf8 and CSV parsing', () => {
  it('accepts UTF-8 with and without BOM and preserves non-ASCII exactly', () => {
    const text = 'Müller, عائشة, عمران, 🙂';
    const bytes = new TextEncoder().encode(text);
    expect(decodeUtf8(bytes)).toEqual({ ok: true, text });
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]))).toEqual({ ok: true, text });
  });
  it('rejects invalid UTF-8 with a clear message', () => {
    const r = decodeUtf8(new Uint8Array([0x61, 0xc3, 0x28, 0x62]));
    expect(r.ok).toBe(false);
  });
  it.each([
    ['a,b,c\n1,2,3', ','],
    ['a;b;c\n1;2;3', ';'],
    ['a\tb\tc', '\t'],
    ['"x;y",b,c', ','],
    ['single', ','],
  ] as const)('detects delimiter in %j', (text, d) => {
    expect(detectDelimiter(text)).toBe(d);
  });
  it('reports the START line of records with multi-line cells, across CRLF, LF and blank lines', () => {
    const r = parseCsv('h1,h2\r\nA,"line one\r\nline two\r\nline three"\r\n\r\nB,x\nC,y', ',');
    expect(r.ok && r.records.map((x) => [x.line, x.cells[0]])).toEqual([[1, 'h1'], [2, 'A'], [6, 'B'], [7, 'C']]);
  });
  it('turns unbalanced quotes into an error result', () => {
    expect(parseCsv('a,b\n"open,1\n', ',').ok).toBe(false);
  });
});

describe('contacts', () => {
  it('normalises email (trim, lower-case) and flags invalid ones', () => {
    expect(normaliseEmail('  Ali@Example.COM ')).toEqual({ email: 'ali@example.com', invalid: false });
    expect(normaliseEmail('not-an-email')).toEqual({ email: null, invalid: true });
    expect(normaliseEmail('')).toEqual({ email: null, invalid: false });
  });
  it('three formats of one Pakistani number -> one E.164', () => {
    const forms = ['0300 1234567', '+92 300 1234567', '0092-300-1234567'].map((p) => normalisePhone(p, 'PK').phone);
    expect(new Set(forms)).toEqual(new Set(['+923001234567']));
  });
  it('a US national number uses the default country; garbage is invalid, not a crash', () => {
    expect(normalisePhone('(415) 555-2671', 'US')).toEqual({ phone: '+14155552671', invalid: false });
    expect(normalisePhone('12345', 'DE')).toEqual({ phone: null, invalid: true });
    expect(normalisePhone('call me', 'US')).toEqual({ phone: null, invalid: true });
  });
});

describe('reference codes', () => {
  it('are 8 characters from the unambiguous alphabet and validate', () => {
    const random = seeded(1);
    for (let i = 0; i < 200; i++) {
      const code = generateReferenceCode(random);
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
      expect(isValidReferenceCode(code)).toBe(true);
    }
  });
  it('the same random source gives the same codes (deterministic, injected)', () => {
    const a = Array.from({ length: 5 }, ((r) => () => generateReferenceCode(r))(seeded(7)));
    const b = Array.from({ length: 5 }, ((r) => () => generateReferenceCode(r))(seeded(7)));
    expect(a).toEqual(b);
  });
  it('the validator accepts what a person types (lower-case, dashes, spaces)', () => {
    const code = generateReferenceCode(seeded(3));
    expect(isValidReferenceCode(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `)).toBe(true);
    expect(normaliseReferenceCode('ab-cd ef')).toBe('ABCDEF');
  });
  it('the check character catches EVERY single-character typo', () => {
    const random = seeded(11);
    for (let n = 0; n < 50; n++) {
      const code = generateReferenceCode(random);
      for (let i = 0; i < code.length; i++) {
        for (const c of REFERENCE_ALPHABET) {
          if (c === code[i]) continue;
          expect(isValidReferenceCode(code.slice(0, i) + c + code.slice(i + 1))).toBe(false);
        }
      }
    }
  });
  it('the check character catches adjacent swaps (all but the rare pairs Luhn mod N cannot see)', () => {
    const random = seeded(12);
    let swaps = 0;
    let caught = 0;
    for (let n = 0; n < 500; n++) {
      const code = generateReferenceCode(random);
      for (let i = 0; i + 1 < code.length; i++) {
        if (code[i] === code[i + 1]) continue;
        swaps++;
        if (!isValidReferenceCode(code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2))) caught++;
      }
    }
    expect(caught / swaps).toBeGreaterThan(0.99);
  });
  it('rejects wrong length and foreign characters', () => {
    expect(isValidReferenceCode('ABC')).toBe(false);
    expect(isValidReferenceCode('ABCDEF0O')).toBe(false);
  });
});

describe('neutraliseCell (OWASP CSV injection)', () => {
  it.each([
    ['=1+2', `"'=1+2"`],
    ['+1', `"'+1"`],
    ['-1', `"'-1"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['\t=cmd', `"'\t=cmd"`],
    ['\r=cmd', `"'\r=cmd"`],
    ['\n=cmd', `"'\n=cmd"`],
    ['＝1+2', `"'＝1+2"`],
    ['  =HYPERLINK("http://x")', `"'  =HYPERLINK(""http://x"")"`],
    ['=1+2";=1+2', `"'=1+2"";=1+2"`],
    ['Müller & Söhne', '"Müller & Söhne"'],
    ['say "hi"', '"say ""hi"""'],
  ])('%j -> %s', (input, out) => {
    expect(neutraliseCell(input)).toBe(out);
  });
});
