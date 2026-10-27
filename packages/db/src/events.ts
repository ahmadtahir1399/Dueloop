// Event types allowed in invoice_events.type. MUST equal the CHECK list in
// supabase/migrations/0001_core.sql (drift test in packages/db/test-db).
// Guide Section 3.5, plus InvoiceImported / InvoiceImportUpdated (added in prompt 2).
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
] as const;
export type InvoiceEventType = (typeof INVOICE_EVENT_TYPES)[number];
