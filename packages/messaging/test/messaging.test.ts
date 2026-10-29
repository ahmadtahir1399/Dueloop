import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BANNED_WORDING,
  DEFAULT_TEMPLATES,
  FOOTER_SEPARATOR,
  TEMPLATE_VARIABLES,
  TokenBucketLimiter,
  appendFooter,
  checkBudget,
  footerFor,
  formatAmount,
  formatDueDate,
  isSafeAddress,
  paymentBlock,
  safePayLink,
  jitterMinutes,
  messageIdFor,
  monthStart,
  placeholders,
  render,
  route,
  sanitiseDisplayName,
  sanitiseHeaderValue,
  type RouteInput,
} from '../src/index.ts';

const allVars = Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v, `<${v}>`]));

describe('render (fails closed)', () => {
  it('substitutes known variables', () => {
    expect(render('Hi {{customer_name}}, pay {{ amount_due }}', allVars)).toEqual({ ok: true, text: 'Hi <customer_name>, pay <amount_due>' });
  });
  it('rejects unknown variables', () => {
    expect(render('Hi {{nickname}}', allVars)).toEqual({ ok: false, error: 'unknown template variable(s): nickname' });
  });
  it('rejects missing variables instead of sending "{{x}}"', () => {
    expect(render('Pay {{amount_due}}', {})).toEqual({ ok: false, error: 'missing template variable(s): amount_due' });
  });
  it('an EMPTY pay_link is allowed (supplied but blank)', () => {
    expect(render('Link: {{pay_link}}.', { pay_link: '' })).toEqual({ ok: true, text: 'Link: .' });
  });
  it('rejects unbalanced braces', () => {
    expect(render('Hi {{customer_name}} }}', allVars).ok).toBe(false);
  });
  it('a variable value containing "{{x}}" is not re-expanded', () => {
    expect(render('Hi {{customer_name}}', { customer_name: 'Bob' })).toEqual({ ok: true, text: 'Hi Bob' });
    expect(render('Hi {{customer_name}}', { customer_name: '{{amount_due}}' }).ok).toBe(false);
  });
  it('property: rendering known templates with all variables never leaves a placeholder', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DEFAULT_TEMPLATES), fc.string({ maxLength: 40 }), (t, value) => {
        const safe = value.replace(/[{}]/g, '');
        const r = render(t.body, Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v, safe])));
        return r.ok && !r.text.includes('{{');
      }),
    );
  });
});

describe('money and dates at the edge', () => {
  it.each([
    [125000, 'JPY', 'en', '¥125,000'],
    [125000, 'USD', 'en', '$1,250.00'],
    [12345, 'KWD', 'en', 'KWD 12.345'],
    [10000000, 'PKR', 'en', 'PKR 100,000.00'],
    [125050, 'EUR', 'de', '1.250,50 €'],
  ])('%d %s in %s', (minor, cur, locale, want) => {
    expect(formatAmount(minor, cur, locale).replace(/\u00A0/g, ' ')).toBe(want);
  });
  it('dates follow the customer locale', () => {
    expect(formatDueDate('2026-03-04', 'en-GB')).toBe('4 Mar 2026');
    expect(formatDueDate('2026-03-04', 'en-US')).toBe('Mar 4, 2026');
    expect(formatDueDate('2026-03-04', 'de')).toBe('4. März 2026');
  });
});

describe('footer', () => {
  it('is appended after the (possibly edited) body and cannot be edited away', () => {
    const edited = 'Body edited by a human with no footer';
    const out = appendFooter(edited, 'email', 'en');
    expect(out.startsWith(edited)).toBe(true);
    expect(out.endsWith(footerFor('email', 'en'))).toBe(true);
    expect(out).toContain(FOOTER_SEPARATOR);
  });
  it('uses the language and falls back to English', () => {
    expect(footerFor('email', 'de-AT')).toContain('antworten Sie auf diese E-Mail');
    expect(footerFor('email', 'de-AT')).not.toBe(footerFor('email', 'en'));
    expect(footerFor('whatsapp', 'xx')).toBe(footerFor('whatsapp', 'en'));
  });
});

describe('header sanitising (issue J)', () => {
  it.each([
    ['Evil\r\nBcc: victim@example.com', 'Evil Bcc: victim@example.com'],
    ['Evil\nX-Injected: 1', 'Evil X-Injected: 1'],
    ['Null\u0000byte', 'Null byte'],
    ['Line sep', 'Line sep'],
    ['  lots   of   space  ', 'lots of space'],
  ])('%j', (input, out) => {
    expect(sanitiseHeaderValue(input)).toBe(out);
  });
  it('caps very long values and keeps unicode intact', () => {
    expect([...sanitiseHeaderValue('ü'.repeat(500))].length).toBe(200);
    expect(sanitiseHeaderValue('شركة الأمل 😀')).toBe('شركة الأمل 😀');
  });
  it('display names lose address-breaking characters', () => {
    expect(sanitiseDisplayName('"Bob" <evil@x.example>\r\nBcc: y')).toBe('Bob evil@x.example Bcc: y');
  });
  it('property: no sanitised value ever contains CR or LF', () => {
    fc.assert(fc.property(fc.string(), (s) => !/[\r\n]/.test(sanitiseHeaderValue(s)) && !/[\r\n]/.test(sanitiseDisplayName(s))));
  });
  it('rejects unsafe addresses', () => {
    expect(isSafeAddress('a@example.com')).toBe(true);
    expect(isSafeAddress('a@example.com\r\nBcc: b@x.example')).toBe(false);
    expect(isSafeAddress('a@example.com, b@example.com')).toBe(false);
  });
  it('Message-IDs are stable per key and well-formed', () => {
    const id = messageIdFor('6f1c2c9e-0000-4000-8000-000000000001:s1:email', 'mail.example.com');
    expect(id).toBe('<6f1c2c9e-0000-4000-8000-000000000001.s1.email.dueloop@mail.example.com>');
    expect(messageIdFor('x:s1:email', 'm.example')).toBe(messageIdFor('x:s1:email', 'm.example'));
  });
});

describe('budget (issue H)', () => {
  it('email is never budgeted; paid channels need budget; 0 blocks them', () => {
    expect(checkBudget('email', 0, 999)).toEqual({ ok: true, cost: 0 });
    expect(checkBudget('whatsapp', 0, 0)).toEqual({ ok: false, reason: 'budget_exhausted', cost: 10 });
    expect(checkBudget('whatsapp', 100, 90)).toEqual({ ok: true, cost: 10 });
    expect(checkBudget('whatsapp', 100, 91)).toEqual({ ok: false, reason: 'budget_exhausted', cost: 10 });
  });
  it('the month boundary is the tenant local month', () => {
    // 2026-02-28T20:00Z is already 1 March in Asia/Karachi (+05:00), still February in New York.
    const at = new Date('2026-02-28T20:00:00Z');
    expect(monthStart(at, 'Asia/Karachi').toISOString()).toBe('2026-02-28T19:00:00.000Z');
    expect(monthStart(at, 'America/New_York').toISOString()).toBe('2026-02-01T05:00:00.000Z');
  });
});

describe('router (no fallback chain)', () => {
  const base: RouteInput = {
    stepChannel: 'whatsapp',
    customer: { email: 'a@example.com', phoneE164: '+923001234567' },
    consents: ['whatsapp'],
    accounts: ['email', 'whatsapp'],
    template: { found: true, providerStatus: 'approved' },
    budgetMinor: 1000,
    spentThisMonthMinor: 0,
  };
  it('routes to the step channel when everything is in place', () => {
    expect(route(base)).toEqual({ ok: true, channel: 'whatsapp', cost: 10 });
  });
  it.each([
    [{ customer: { email: 'a@example.com', phoneE164: null } }, 'no_contact'],
    [{ consents: [] }, 'no_consent'],
    [{ budgetMinor: 0 }, 'budget_exhausted'],
    [{ template: { found: false, providerStatus: null } }, 'template_missing'],
    [{ template: { found: true, providerStatus: 'pending' } }, 'template_unapproved'],
    [{ accounts: ['email'] }, 'account_missing'],
  ] as const)('%j -> %s (and never falls back to email)', (override, reason) => {
    expect(route({ ...base, ...override } as RouteInput)).toEqual({ ok: false, reason });
  });
  it('email needs no consent and no budget', () => {
    expect(route({ ...base, stepChannel: 'email', consents: [], budgetMinor: 0, template: { found: true, providerStatus: null } })).toEqual({
      ok: true,
      channel: 'email',
      cost: 0,
    });
  });
});

describe('pacing', () => {
  it('token bucket with a fake clock', () => {
    let now = 0;
    const l = new TokenBucketLimiter(() => ({ capacity: 2, refillPerSecond: 1 }), () => now);
    expect([l.tryTake('k'), l.tryTake('k')]).toEqual([0, 0]);
    expect(l.tryTake('k')).toBe(1000);
    now = 500;
    expect(l.tryTake('k')).toBe(500);
    now = 1000;
    expect(l.tryTake('k')).toBe(0);
    expect(l.tryTake('other')).toBe(0);
  });
  it('jitter is deterministic, forward-only and within the window', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.integer({ min: 1, max: 120 }), (id, w) => {
        const j = jitterMinutes(id, w);
        return j === jitterMinutes(id, w) && j >= 0 && j < w;
      }),
    );
  });
});

describe('default templates', () => {
  it('use only known variables and render', () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(render(t.body, allVars).ok, `${t.templateKey}/${t.channel}`).toBe(true);
      if (t.subject) expect(render(t.subject, allVars).ok).toBe(true);
      // Prompt 5: reminders carry the reference code directly or inside the code-composed payment block.
      if (t.templateKey !== 'receipt') expect(placeholders(t.body).some((v) => v === 'reference_code' || v === 'payment_block'), `${t.templateKey}/${t.channel}`).toBe(true);
    }
  });
  it('every email reminder uses the payment block (current balance + reference, prompt 5)', () => {
    for (const t of DEFAULT_TEMPLATES.filter((x) => x.channel === 'email' && x.templateKey !== 'receipt')) expect(placeholders(t.body)).toContain('payment_block');
  });
  it('receipts state the amount received and the remaining balance', () => {
    for (const t of DEFAULT_TEMPLATES.filter((x) => x.templateKey === 'receipt')) expect(placeholders(t.body)).toEqual(expect.arrayContaining(['amount_received', 'balance_remaining', 'invoice_number']));
  });
  it('contain no threatening or legally loaded wording', () => {
    for (const t of DEFAULT_TEMPLATES) {
      const text = `${t.subject ?? ''} ${t.body}`.toLowerCase();
      for (const w of BANNED_WORDING) expect(text, `${t.templateKey}/${t.channel} contains "${w}"`).not.toMatch(new RegExp(`\\b${w}\\b`));
    }
  });
});

describe('payment block (prompt 5)', () => {
  it('always has the amount and the reference code; the link only when given', () => {
    const b = paymentBlock({ amountDue: '£12.50', referenceCode: 'REF1', bankText: '  Sort code on file  ', link: null });
    expect(b).toBe('To pay £12.50 by bank transfer, please quote REF1.\nSort code on file');
    const l = paymentBlock({ amountDue: '£12.50', referenceCode: 'REF1', bankText: '', link: 'https://pay.example.test/x' });
    expect(l).toBe('Pay £12.50 online: https://pay.example.test/x\n\nTo pay £12.50 by bank transfer, please quote REF1.');
  });
  it('safePayLink keeps plain https links and drops everything else', () => {
    expect(safePayLink('https://buy.stripe.com/test_abc')).toBe('https://buy.stripe.com/test_abc');
    for (const bad of [null, '', 'http://x.test/a', 'javascript:alert(1)', 'https://u:p@x.test/', 'https://x.test:8443/a', 'https://x.test/a b', 'https://x.test/<script>', 'https://localhost/a', `https://x.test/${'a'.repeat(600)}`, 'not a url'])
      expect(safePayLink(bad), String(bad)).toBeNull();
  });
});
