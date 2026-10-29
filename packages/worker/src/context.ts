// Fresh context for one invoice (protocol step 1), built with the packages/db mappers.
// Rule C: history.sentAt = ALL outbound reminders to the CUSTOMER (weekly cap per customer), while
//         history.sentStepIds stays per INVOICE.
// Prompt 5: receipts are not reminders; they never count toward the weekly cap (they do count toward budget).
// Rule E: steps that were skipped (rejected approval, no contact/consent) or failed permanently count as
//         "sent" for sentStepIds (never proposed again) but NOT for sentAt (nothing reached the customer).
import type { Channel, Ctx, Policy, Settings } from '@dueloop/core';
import { invoiceRowToCtxInvoice, policyRowToPolicy, tenantToSettings } from '@dueloop/db';
import { isSafeAddress } from '@dueloop/messaging';
import type { WorkerDb } from './db.ts';

export interface TemplateRow {
  readonly templateKey: string;
  readonly channel: Channel;
  readonly locale: string;
  readonly subject: string | null;
  readonly body: string;
  readonly providerTemplateName: string | null;
  readonly providerLanguage: string | null;
  readonly providerStatus: string | null;
}

export interface WorkerContext {
  readonly invoice: {
    readonly id: string;
    readonly tenantId: string;
    readonly number: string;
    readonly status: string;
    readonly dueOn: string;
    readonly promisedOn: string | null;
    readonly currency: string;
    readonly balanceMinor: number;
    readonly referenceCode: string;
    readonly customerId: string;
  };
  readonly customer: { readonly name: string; readonly email: string | null; readonly phone: string | null; readonly language: string; readonly optedOut: boolean };
  readonly tenant: { readonly name: string; readonly approvalMode: string; readonly budgetMinor: number; readonly bankInstructions: string };
  readonly settings: Settings;
  readonly policy: Policy;
  readonly sentStepIds: readonly string[];
  readonly customerSentAt: readonly Date[];
  readonly escalated: boolean;
  readonly consents: readonly Channel[];
  readonly accounts: ReadonlyMap<Channel, Readonly<Record<string, unknown>>>;
  readonly templates: readonly TemplateRow[];
}

export type LoadResult = { readonly ok: true; readonly ctx: WorkerContext } | { readonly ok: false; readonly reason: string };

/** States that mean "this step has been dealt with" for decide() (rule E). pending/retry are NOT here. */
const STEP_DONE = ['sent', 'unknown', 'skipped', 'failed_permanent'];
/** States that may have reached the customer, for the weekly cap (rule C). */
const MAY_HAVE_REACHED = ['sent', 'unknown', 'pending'];

export async function loadContext(db: WorkerDb, tenantId: string, invoiceId: string): Promise<LoadResult> {
  const base = await db.pool.query(
    `select i.id, i.tenant_id, i.number, i.status, i.due_on::text as due_on, i.promised_on::text as promised_on, i.currency,
            i.reference_code, i.customer_id, b.balance,
            c.display_name, c.email, c.phone_e164, c.language, c.opted_out,
            t.name as tenant_name, t.timezone, t.quiet_start_hour, t.quiet_end_hour, t.approval_mode,
            t.monthly_message_budget_minor, t.bank_instructions,
            p.steps, p.escalate_after_days, p.grace_days_after_promise, p.max_messages_per_week
     from public.invoices i
     join public.customers c on c.tenant_id = i.tenant_id and c.id = i.customer_id
     join public.tenants t on t.id = i.tenant_id
     join public.invoice_balances b on b.invoice_id = i.id
     left join public.policies p on p.tenant_id = i.tenant_id
       and p.id = coalesce(i.policy_id, (select d.id from public.policies d where d.tenant_id = i.tenant_id and d.is_default))
     where i.tenant_id = $1 and i.id = $2`,
    [tenantId, invoiceId],
  );
  const r = base.rows[0];
  if (!r) return { ok: false, reason: 'invoice_not_found' };
  if (r.steps === null) return { ok: false, reason: 'policy_missing' };

  const [holidays, history, sentAt, escalatedEv, consents, accounts, templates] = await Promise.all([
    db.pool.query(`select tenant_id, on_date::text as on_date from public.holidays where tenant_id = $1`, [tenantId]),
    db.pool.query(
      `select distinct m.step_id from public.messages m
       join public.message_invoices mi on mi.tenant_id = m.tenant_id and mi.message_id = m.id
       where mi.tenant_id = $1 and mi.invoice_id = $2 and m.direction = 'out' and m.step_id is not null and m.send_state = any($3)`,
      [tenantId, invoiceId, STEP_DONE],
    ),
    db.pool.query(
      `select coalesce(sent_at, pending_since) as at from public.messages
       where tenant_id = $1 and customer_id = $2 and direction = 'out' and purpose = 'reminder' and send_state = any($3) and coalesce(sent_at, pending_since) is not null`,
      [tenantId, r.customer_id, MAY_HAVE_REACHED],
    ),
    db.pool.query(`select 1 from public.invoice_events where tenant_id = $1 and invoice_id = $2 and type = 'InvoiceEscalated' limit 1`, [tenantId, invoiceId]),
    db.pool.query(`select channel from public.customer_consents where tenant_id = $1 and customer_id = $2 and revoked_at is null`, [tenantId, r.customer_id]),
    db.pool.query(`select channel, config from public.channel_accounts where tenant_id = $1 and enabled`, [tenantId]),
    db.pool.query(
      `select template_key, channel, locale, subject, body, provider_template_name, provider_language, provider_status
       from public.templates where tenant_id = $1`,
      [tenantId],
    ),
  ]);

  const settings = tenantToSettings(
    { id: r.tenant_id, timezone: r.timezone, quiet_start_hour: r.quiet_start_hour, quiet_end_hour: r.quiet_end_hour },
    holidays.rows,
  );
  if (!settings.ok) return { ok: false, reason: 'settings_invalid' };
  const policy = policyRowToPolicy({
    steps: r.steps,
    escalate_after_days: r.escalate_after_days,
    grace_days_after_promise: r.grace_days_after_promise,
    max_messages_per_week: r.max_messages_per_week,
  });
  if (!policy.ok) return { ok: false, reason: 'policy_invalid' };
  const inv = invoiceRowToCtxInvoice({ id: r.id, status: r.status, due_on: r.due_on, promised_on: r.promised_on });
  if (!inv.ok) return { ok: false, reason: 'invoice_invalid' };

  return {
    ok: true,
    ctx: {
      invoice: {
        id: r.id,
        tenantId: r.tenant_id,
        number: r.number,
        status: r.status,
        dueOn: r.due_on,
        promisedOn: r.promised_on,
        currency: r.currency.trim(),
        balanceMinor: Number(r.balance),
        referenceCode: r.reference_code,
        customerId: r.customer_id,
      },
      customer: { name: r.display_name, email: r.email, phone: r.phone_e164, language: r.language, optedOut: r.opted_out },
      tenant: {
        name: r.tenant_name,
        approvalMode: r.approval_mode,
        budgetMinor: Number(r.monthly_message_budget_minor),
        bankInstructions: r.bank_instructions ?? '',
      },
      settings: settings.value,
      policy: policy.value,
      sentStepIds: history.rows.map((x) => x.step_id as string),
      customerSentAt: sentAt.rows.map((x) => x.at as Date),
      escalated: r.status === 'escalated' || escalatedEv.rows.length > 0,
      consents: consents.rows.map((x) => x.channel as Channel),
      accounts: new Map(accounts.rows.map((x) => [x.channel as Channel, x.config as Record<string, unknown>])),
      templates: templates.rows.map((t) => ({
        templateKey: t.template_key,
        channel: t.channel,
        locale: t.locale,
        subject: t.subject,
        body: t.body,
        providerTemplateName: t.provider_template_name,
        providerLanguage: t.provider_language,
        providerStatus: t.provider_status,
      })),
    },
  };
}

/** The pure decide() input, with "now" injected. */
export function toCtx(c: WorkerContext, now: Date): Ctx {
  return {
    now,
    invoice: {
      id: c.invoice.id,
      status: c.invoice.status as Ctx['invoice']['status'],
      dueOn: c.invoice.dueOn,
      ...(c.invoice.promisedOn === null ? {} : { promisedOn: c.invoice.promisedOn }),
    },
    customer: { optedOut: c.customer.optedOut },
    history: { sentStepIds: c.sentStepIds, sentAt: c.customerSentAt, escalated: c.escalated },
    policy: c.policy,
    settings: c.settings,
  };
}

/** Template for (key, channel) in the customer's locale: exact tag, then language, then English. */
/**
 * Channels whose account is READY to send: an email account needs a safe sender address, a WhatsApp account its
 * phone number id; and an adapter must be wired. Anything else routes as account_missing, which parks the invoice
 * with an alert (and "Resume reminders" once fixed) instead of failing later as a silent skip (review round 2:
 * saving only the SMTP password created an account with config {}).
 */
export function readyChannels(accounts: ReadonlyMap<Channel, Readonly<Record<string, unknown>>>, wired: (ch: Channel) => boolean): Channel[] {
  return [...accounts.entries()]
    .filter(([ch, config]) => {
      if (!wired(ch)) return false;
      if (ch === 'email') return isSafeAddress(String(config.from_address ?? ''));
      if (ch === 'whatsapp') return /^\d{1,32}$/.test(String(config.phone_number_id ?? ''));
      return true;
    })
    .map(([ch]) => ch);
}

export function pickTemplate(templates: readonly TemplateRow[], key: string, channel: Channel, locale: string): TemplateRow | null {
  const lang = locale.split('-')[0]?.toLowerCase() ?? 'en';
  const candidates = templates.filter((t) => t.templateKey === key && t.channel === channel);
  return (
    candidates.find((t) => t.locale.toLowerCase() === locale.toLowerCase()) ??
    candidates.find((t) => t.locale.toLowerCase() === lang) ??
    candidates.find((t) => t.locale.toLowerCase() === 'en') ??
    null
  );
}
