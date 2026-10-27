// Pure DB row -> core mappers. No I/O. Bad data yields a result object, never a throw.
import {
  CHANNELS,
  INVOICE_STATUSES,
  validateSettings,
  type Ctx,
  type InvoiceStatus,
  type Policy,
  type Settings,
} from '@dueloop/core';
import { z } from 'zod';
import type { Database } from './database.types.ts';

type Tables = Database['public']['Tables'];
export type TenantRow = Tables['tenants']['Row'];
export type HolidayRow = Tables['holidays']['Row'];
export type PolicyRow = Tables['policies']['Row'];
export type InvoiceRow = Tables['invoices']['Row'];
export type CustomerRow = Tables['customers']['Row'];

export interface MapError {
  readonly field: string;
  readonly message: string;
}
export type MapResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly MapError[] };

const ok = <T>(value: T): MapResult<T> => ({ ok: true, value });
const fail = <T>(errors: MapError[]): MapResult<T> => ({ ok: false, errors });

/** Tenant row + its holiday rows -> core Settings, validated by core's own validateSettings(). */
export function tenantToSettings(
  tenant: Pick<TenantRow, 'id' | 'timezone' | 'quiet_start_hour' | 'quiet_end_hour'>,
  holidays: readonly Pick<HolidayRow, 'tenant_id' | 'on_date'>[],
): MapResult<Settings> {
  const foreign = holidays.filter((h) => h.tenant_id !== tenant.id);
  if (foreign.length > 0) return fail([{ field: 'holidays', message: 'holiday rows belong to another tenant' }]);
  const settings: Settings = {
    timezone: tenant.timezone,
    quietHours: { startHour: tenant.quiet_start_hour, endHour: tenant.quiet_end_hour },
    holidays: holidays.map((h) => h.on_date).sort(),
  };
  const v = validateSettings(settings);
  return v.ok ? ok(v.value) : fail([...v.errors]);
}

const stepSchema = z
  .object({
    id: z.string().min(1),
    daysAfterDue: z.int().min(0),
    channel: z.enum(CHANNELS),
    templateKey: z.string().min(1),
  })
  .strict();

const stepsSchema = z
  .array(stepSchema)
  .refine((steps) => new Set(steps.map((s) => s.id)).size === steps.length, { message: 'step ids must be unique' });

/** policies row -> core Policy. steps jsonb is untrusted data, validated with zod. */
export function policyRowToPolicy(
  row: Pick<PolicyRow, 'escalate_after_days' | 'grace_days_after_promise' | 'max_messages_per_week'> & { readonly steps: unknown },
): MapResult<Policy> {
  const parsed = stepsSchema.safeParse(row.steps);
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => ({ field: ['steps', ...i.path].join('.'), message: i.message })));
  }
  return ok({
    steps: parsed.data,
    escalateAfterDays: row.escalate_after_days,
    graceDaysAfterPromise: row.grace_days_after_promise,
    maxMessagesPerWeek: row.max_messages_per_week,
  });
}

function isStatus(s: string): s is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(s);
}

/** invoices row -> the Ctx.invoice piece decide() needs. */
export function invoiceRowToCtxInvoice(
  row: Pick<InvoiceRow, 'id' | 'status' | 'due_on' | 'promised_on'>,
): MapResult<Ctx['invoice']> {
  if (!isStatus(row.status)) return fail([{ field: 'status', message: `unknown status: ${row.status}` }]);
  return ok({
    id: row.id,
    status: row.status,
    dueOn: row.due_on,
    ...(row.promised_on === null ? {} : { promisedOn: row.promised_on }),
  });
}

/** customers row -> the Ctx.customer piece decide() needs. */
export function customerRowToCtxCustomer(row: Pick<CustomerRow, 'opted_out'>): Ctx['customer'] {
  return { optedOut: row.opted_out };
}
