// Template rendering: {{variable}} substitution that FAILS CLOSED. A template may only use known variables,
// and every variable it uses must be supplied, so a literal "{{x}}" can never reach a customer.
import { currencyExponent, toMajorString } from '@dueloop/core';
import { DateTime } from 'luxon';

export const TEMPLATE_VARIABLES = [
  'customer_name',
  'business_name',
  'invoice_number',
  'amount_due',
  'due_date',
  'days_overdue',
  'reference_code',
  'bank_instructions',
  'pay_link', // prompt 5: the checked gateway link, or '' (kept for tenant templates written before payment_block)
  // Prompt 5.
  'payment_block', // composed by code (paymentBlock): current balance, reference code, link or bank text
  'amount_received', // receipts
  'balance_remaining', // receipts
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVariables = Readonly<Record<TemplateVariable, string>>;

export type RenderResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Variables used by a template, in order of first appearance. */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))];
}

export function render(template: string, vars: Partial<Record<string, string>>): RenderResult {
  const used = placeholders(template);
  const unknown = used.filter((v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v));
  if (unknown.length > 0) return { ok: false, error: `unknown template variable(s): ${unknown.join(', ')}` };
  const missing = used.filter((v) => vars[v] === undefined);
  if (missing.length > 0) return { ok: false, error: `missing template variable(s): ${missing.join(', ')}` };
  const text = template.replace(PLACEHOLDER, (_, name: string) => vars[name.trim()] ?? '');
  if (/\{\{|\}\}/.test(text)) return { ok: false, error: 'unbalanced template braces' };
  return { ok: true, text };
}

/** Money for display only (edge formatting): exact decimal string from minor units, Intl in the customer's locale. */
export function formatAmount(minor: number, currency: string, locale: string): string {
  const major = toMajorString({ minor, currency });
  const exp = currencyExponent(currency);
  if (!major.ok || !exp.ok) return `${minor} ${currency}`;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exp.value,
      maximumFractionDigits: exp.value,
    }).format(major.value as Intl.StringNumericLiteral);
  } catch {
    return `${major.value} ${currency}`; // unknown locale: still exact, never a float
  }
}

/** A calendar date for display in the customer's locale (dates are tenant-local calendar dates). */
export function formatDueDate(isoDate: string, locale: string): string {
  const d = DateTime.fromISO(isoDate, { zone: 'UTC' });
  if (!d.isValid) return isoDate;
  const out = d.setLocale(locale).toLocaleString(DateTime.DATE_MED);
  return out === 'Invalid DateTime' ? isoDate : out;
}
