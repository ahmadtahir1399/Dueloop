// Event types allowed in invoice_events.type. MUST equal the CHECK list in
// supabase/migrations/0001_core.sql (drift test in packages/db/test-db).
// Guide Section 3.5, plus InvoiceImported / InvoiceImportUpdated (prompt 2) and the sending events (prompt 3).
export const INVOICE_EVENT_TYPES = [
  'ReminderScheduled',
  'ReminderSent',
  'ReminderFailed',
  'ReplyReceived',
  'ReplyClassified',
  'PromiseRecorded',
  'PromiseBroken',
  'DisputeRaised',
  'ProofSubmitted',
  'ProofVerified',
  'PaymentConfirmed',
  'PartialPaymentConfirmed',
  'InvoiceEscalated',
  'InvoiceWrittenOff',
  'OptOutRecorded',
  'ApprovalRequested',
  'ApprovalGranted',
  'ApprovalRejected',
  'InvoiceImported',
  'InvoiceImportUpdated',
  // Prompt 3 (sending): ADR 0013.
  'InvoiceOverdue',
  'ReminderSkipped',
  'ReminderParked',
  'ApprovalExpired',
  'ApprovalSuperseded',
  'MessageStateUnknown',
  'MessageReconciled',
  // Prompt 4 (replies + promises).
  'PromiseSuperseded',
  'PromiseCancelled',
  'PaymentClaimReceived',
  'ReplyNeedsReview',
  'DeliveryFailed',
  'RemindersBlocked',
  'RemindersResumed',
  // Prompt 5 (payments).
  'PromiseKept',
  'PaymentCreditCreated',
  'PaymentReversed',
  'PaymentFailed',
  'PaymentRequestCreated',
  'PaymentRequestDeactivated',
  'ProofRejected',
  'ReminderAfterPayment',
  'ReceiptSkipped',
] as const;
export type InvoiceEventType = (typeof INVOICE_EVENT_TYPES)[number];

// Tenant- and customer-level events (prompt 4, issue H). MUST equal the CHECK list on public.tenant_events.
export const TENANT_EVENT_TYPES = ['OptOutRecorded', 'ReplyUnmatched', 'ReplyAmbiguous', 'DeliveryFailed', 'InboundDeadLettered', 'AutoReplyReceived', 'PaymentUnmatched', 'PaymentEventDeadLettered', 'AuditExported', 'MemberRoleChanged', 'MemberRemoved'] as const;
export type TenantEventType = (typeof TENANT_EVENT_TYPES)[number];
