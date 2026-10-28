// The staff role matrix as DATA (rule 33). One source for UI gating, tests and docs: the web app hides what a
// role cannot do, the tests compare every cell with the database, and ADR 0042 carries the same table (a test
// fails when the two differ). Hiding is cosmetic; the database re-checks role and tenant on every mutation.

export const ROLES = ['owner', 'accountant', 'collector'] as const;
export type Role = (typeof ROLES)[number];

export interface Permission {
  /** Stable id, used in code and in ADR 0042. */
  readonly id: string;
  readonly label: string;
  readonly roles: readonly Role[];
  /** Where the database enforces it (for docs and the bypass tests). */
  readonly enforcedBy: string;
}

const ALL: readonly Role[] = ['owner', 'accountant', 'collector'];
const OA: readonly Role[] = ['owner', 'accountant'];
const O: readonly Role[] = ['owner'];

export const PERMISSIONS = [
  { id: 'overview.view', label: 'See the overview and KPIs', roles: ALL, enforcedBy: 'RLS (security_invoker KPI functions)' },
  { id: 'invoices.view', label: 'See invoices, timelines and balances', roles: ALL, enforcedBy: 'RLS' },
  { id: 'customers.view', label: 'See customers, consents and opt-out state', roles: ALL, enforcedBy: 'RLS' },
  { id: 'inbox.view', label: 'See the inbox (inbound messages)', roles: ALL, enforcedBy: 'RLS' },
  { id: 'approvals.view', label: 'See approvals', roles: ALL, enforcedBy: 'RLS' },
  { id: 'approvals.decide', label: 'Approve, reject or edit an approval', roles: OA, enforcedBy: 'decide_approval / edit_approval' },
  { id: 'tasks.view', label: 'See tasks', roles: ALL, enforcedBy: 'RLS' },
  { id: 'tasks.resolve', label: 'Resolve or reopen a task', roles: ALL, enforcedBy: 'resolve_task / reopen_task' },
  { id: 'promises.cancel', label: 'Cancel a promise', roles: OA, enforcedBy: 'cancel_promise' },
  { id: 'proofs.view', label: 'See payment proofs and open the file', roles: ALL, enforcedBy: 'RLS + member check before signing a URL' },
  { id: 'proofs.decide', label: 'Confirm or reject a payment proof', roles: OA, enforcedBy: 'apply_payment / reject_proof role check' },
  { id: 'payments.record', label: 'Record a manual payment', roles: OA, enforcedBy: 'apply_payment role check' },
  { id: 'messages.reconcile', label: 'Reconcile a message in an unknown state', roles: OA, enforcedBy: 'reconcile_unknown_message' },
  { id: 'import.run', label: 'Import invoices (CSV)', roles: OA, enforcedBy: 'RLS on import_batches + commit_import_batch' },
  { id: 'export.lists', label: 'Export invoice and customer lists (CSV)', roles: ALL, enforcedBy: 'RLS' },
  { id: 'export.audit', label: 'Export the audit log (CSV)', roles: OA, enforcedBy: 'log_audit_export' },
  { id: 'killswitch.toggle', label: 'Pause or resume all sending for the tenant', roles: O, enforcedBy: 'set_outbound_paused' },
  { id: 'settings.view', label: 'See settings', roles: ALL, enforcedBy: 'RLS' },
  { id: 'settings.edit', label: 'Change tenant settings', roles: O, enforcedBy: 'save_tenant_settings' },
  { id: 'policies.edit', label: 'Edit reminder policies', roles: OA, enforcedBy: 'save_policy' },
  { id: 'templates.edit', label: 'Edit message templates', roles: OA, enforcedBy: 'save_template' },
  { id: 'holidays.edit', label: 'Edit holidays', roles: OA, enforcedBy: 'RLS (holidays R W D)' },
  { id: 'members.view', label: 'See members', roles: ALL, enforcedBy: 'RLS' },
  { id: 'members.manage', label: 'Invite, change or remove members', roles: O, enforcedBy: 'set_member_role / remove_member + last-owner trigger' },
  { id: 'integrations.view', label: 'See connection status of channels and payment accounts', roles: OA, enforcedBy: 'RLS' },
  { id: 'integrations.manage', label: 'Connect channels and payment accounts, set or rotate secrets', roles: O, enforcedBy: 'owner-only secret RPCs' },
  { id: 'webhook_urls.view', label: 'See webhook URLs (they contain opaque tokens)', roles: O, enforcedBy: 'shown once by rotate_payment_webhook_token' },
  { id: 'api_keys.manage', label: 'Create, list and revoke API keys', roles: O, enforcedBy: 'create_api_key / revoke_api_key' },
] as const satisfies readonly Permission[];

export type PermissionId = (typeof PERMISSIONS)[number]['id'];

const BY_ID: ReadonlyMap<string, Permission> = new Map(PERMISSIONS.map((p) => [p.id, p]));

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/** Does the role hold the permission? Unknown roles and unknown permissions are denied. */
export function can(role: Role | null | undefined, permission: PermissionId): boolean {
  if (!isRole(role)) return false;
  const p = BY_ID.get(permission);
  return p !== undefined && p.roles.includes(role);
}

/** The matrix as a Markdown table, the exact block ADR 0042 must contain. */
export function matrixMarkdown(): string {
  const head = `| Permission | ${ROLES.join(' | ')} |`;
  const sep = `|---|${ROLES.map(() => '---').join('|')}|`;
  const rows = PERMISSIONS.map((p) => `| \`${p.id}\` | ${ROLES.map((r) => ((p.roles as readonly Role[]).includes(r) ? 'yes' : 'no')).join(' | ')} |`);
  return [head, sep, ...rows].join('\n');
}
