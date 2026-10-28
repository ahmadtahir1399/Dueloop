// Issues I and J: money and time display in the web app.
import { describe, expect, it } from 'vitest';
import { AMOUNT_UNAVAILABLE, formatMinor, minorIsPositive } from '../lib/money.ts';
import { formatInstant, periodRange, tenantToday } from '../lib/time.ts';

describe('formatMinor (issue I)', () => {
  it('formats minor-unit text with the currency exponent from core', () => {
    expect(formatMinor('125050', 'GBP')).toBe('£1,250.50');
    expect(formatMinor('12345', 'KWD').replace(/\s/g, ' ')).toBe('KWD 12.345'); // Intl uses a no-break space
    expect(formatMinor('999', 'JPY')).toBe('¥999');
    expect(formatMinor('-50', 'EUR')).toBe('-€0.50');
  });

  it('keeps every digit beyond 2^53 when the value arrives as text', () => {
    expect(formatMinor('9007199254740993', 'USD')).toBe('$90,071,992,547,409.93');
  });

  it('refuses a rounded JSON number instead of showing a wrong amount', () => {
    expect(formatMinor(Number("9007199254740993"), "USD")).toBe(AMOUNT_UNAVAILABLE); // what JSON.parse would hand us
    expect(formatMinor(1.5, 'USD')).toBe(AMOUNT_UNAVAILABLE);
    expect(formatMinor('12.5', 'USD')).toBe(AMOUNT_UNAVAILABLE);
    expect(formatMinor('100', 'XXZ')).toBe(AMOUNT_UNAVAILABLE);
    expect(formatMinor(null, 'USD')).toBe(AMOUNT_UNAVAILABLE);
    expect(formatMinor('100', null)).toBe(AMOUNT_UNAVAILABLE);
  });

  it('minorIsPositive compares text without Number()', () => {
    expect(minorIsPositive('0')).toBe(false);
    expect(minorIsPositive('000')).toBe(false);
    expect(minorIsPositive('9007199254740993')).toBe(true);
    expect(minorIsPositive('-1')).toBe(false);
  });
});

describe('tenant-zone time (issue J)', () => {
  // 2026-10-28T20:30Z is already the 29th in Auckland (UTC+13) and 02:00 on the 29th in Kolkata (UTC+5:30).
  const at = new Date('2026-10-28T20:30:00Z');

  it('shows instants in the tenant zone, never the host zone', () => {
    expect(formatInstant(at.toISOString(), 'Pacific/Auckland')).toBe('29 Oct 2026, 09:30');
    expect(formatInstant(at.toISOString(), 'Asia/Kolkata')).toBe('29 Oct 2026, 02:00');
    expect(formatInstant(at.toISOString(), 'America/New_York')).toBe('28 Oct 2026, 16:30');
  });

  it("today is the tenant's local date (differs from UTC's)", () => {
    expect(tenantToday('Pacific/Auckland', at)).toBe('2026-10-29');
    expect(tenantToday('UTC', at)).toBe('2026-10-28');
  });

  it('periods are tenant-local days, including half-hour zones', () => {
    expect(periodRange('this_month', 'Asia/Kolkata', at)).toEqual({ from: '2026-10-01', to: '2026-10-29' });
    expect(periodRange('this_week', 'Pacific/Auckland', at)).toEqual({ from: '2026-10-26', to: '2026-10-29' });
    expect(periodRange('last_30', 'UTC', at)).toEqual({ from: '2026-09-29', to: '2026-10-28' });
  });
});
