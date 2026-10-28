
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "approvals": {
                  Row: {
                    "body_override": string | null,"channel": string,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"id": string,"idempotency_key": string,"invoice_id": string,"requested_at": string,"status": string,"step_id": string,"subject_override": string | null,"tenant_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "body_override"?: string | null,"channel": string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"idempotency_key": string,"invoice_id": string,"requested_at": string,"status"?: string,"step_id": string,"subject_override"?: string | null,"tenant_id": string,"version"?: number
                  }
                  Update: {
                    "body_override"?: string | null,"channel"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"id"?: string,"idempotency_key"?: string,"invoice_id"?: string,"requested_at"?: string,"status"?: string,"step_id"?: string,"subject_override"?: string | null,"tenant_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "approvals_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "approvals_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approvals_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id"]
    },{
      foreignKeyName: "approvals_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "approvals_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices_due"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"channel_accounts": {
                  Row: {
                    "channel": string,"config": NonNullable<Json>,"created_at": string,"enabled": boolean,"external_account_id": string | null,"id": string,"secret_id": string | null,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"config"?: NonNullable<Json>,"created_at"?: string,"enabled"?: boolean,"external_account_id"?: string | null,"id"?: string,"secret_id"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "channel"?: string,"config"?: NonNullable<Json>,"created_at"?: string,"enabled"?: boolean,"external_account_id"?: string | null,"id"?: string,"secret_id"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "channel_accounts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "channel_accounts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"credits": {
                  Row: {
                    "amount": number,"created_at": string,"currency": string,"customer_id": string,"id": string,"invoice_id": string,"receipt_id": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at"?: string,"currency": string,"customer_id": string,"id"?: string,"invoice_id": string,"receipt_id": string,"tenant_id": string
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"currency"?: string,"customer_id"?: string,"id"?: string,"invoice_id"?: string,"receipt_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credits_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "credits_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "credits_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "credits_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id"]
    },{
      foreignKeyName: "credits_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "credits_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices_due"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "credits_tenant_id_receipt_id_fkey"
      columns: ["tenant_id","receipt_id"]
isOneToOne: true
      referencedRelation: "receipts"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"customer_consents": {
                  Row: {
                    "channel": string,"customer_id": string,"granted_at": string,"id": string,"revoked_at": string | null,"source": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"customer_id": string,"granted_at": string,"id"?: string,"revoked_at"?: string | null,"source": string,"tenant_id": string
                  }
                  Update: {
                    "channel"?: string,"customer_id"?: string,"granted_at"?: string,"id"?: string,"revoked_at"?: string | null,"source"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_consents_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "customer_consents_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "customer_consents_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "created_at": string,"display_name": string,"email": string | null,"external_id": string | null,"id": string,"language": string,"opted_out": boolean,"phone_e164": string | null,"preferred_channel": string | null,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"email"?: string | null,"external_id"?: string | null,"id"?: string,"language"?: string,"opted_out"?: boolean,"phone_e164"?: string | null,"preferred_channel"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"email"?: string | null,"external_id"?: string | null,"id"?: string,"language"?: string,"opted_out"?: boolean,"phone_e164"?: string | null,"preferred_channel"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "customers_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"dead_letters": {
                  Row: {
                    "attempts": number,"created_at": string,"id": string,"invoice_id": string | null,"payload": NonNullable<Json>,"reason": string,"source": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts": number,"created_at"?: string,"id"?: string,"invoice_id"?: string | null,"payload"?: NonNullable<Json>,"reason": string,"source": string,"tenant_id": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"invoice_id"?: string | null,"payload"?: NonNullable<Json>,"reason"?: string,"source"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "dead_letters_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "dead_letters_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dead_letters_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id"]
    },{
      foreignKeyName: "dead_letters_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "dead_letters_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices_due"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"holidays": {
                  Row: {
                    "label": string | null,"on_date": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "label"?: string | null,"on_date": string,"tenant_id": string
                  }
                  Update: {
                    "label"?: string | null,"on_date"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "holidays_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "holidays_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "committed_at": string | null,"counts": NonNullable<Json>,"created_at": string,"file_name": string,"file_sha256": string,"id": string,"mapping": NonNullable<Json>,"options": NonNullable<Json>,"result": Json | null,"status": string,"tenant_id": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "committed_at"?: string | null,"counts"?: NonNullable<Json>,"created_at"?: string,"file_name": string,"file_sha256": string,"id"?: string,"mapping": NonNullable<Json>,"options": NonNullable<Json>,"result"?: Json | null,"status"?: string,"tenant_id": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "committed_at"?: string | null,"counts"?: NonNullable<Json>,"created_at"?: string,"file_name"?: string,"file_sha256"?: string,"id"?: string,"mapping"?: NonNullable<Json>,"options"?: NonNullable<Json>,"result"?: Json | null,"status"?: string,"tenant_id"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_batches_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "import_batches_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"import_rows": {
                  Row: {
                    "batch_id": string,"errors": NonNullable<Json>,"normalised": Json | null,"raw": NonNullable<Json>,"row_number": number,"skip_reason": string | null,"tenant_id": string,"warnings": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id": string,"errors"?: NonNullable<Json>,"normalised"?: Json | null,"raw": NonNullable<Json>,"row_number": number,"skip_reason"?: string | null,"tenant_id": string,"warnings"?: NonNullable<Json>
                  }
                  Update: {
                    "batch_id"?: string,"errors"?: NonNullable<Json>,"normalised"?: Json | null,"raw"?: NonNullable<Json>,"row_number"?: number,"skip_reason"?: string | null,"tenant_id"?: string,"warnings"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_rows_tenant_id_batch_id_fkey"
      columns: ["tenant_id","batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "import_rows_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "import_rows_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"inbound_events": {
                  Row: {
                    "attempts": number,"channel_account_id": string,"id": number,"kind": string,"last_error": string | null,"payload": Json | null,"processed_at": string | null,"provider": string,"provider_event_id": string,"purge_after": string,"raw_mime": string | null,"received_at": string,"status": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"channel_account_id": string,"id"?: never,"kind": string,"last_error"?: string | null,"payload"?: Json | null,"processed_at"?: string | null,"provider": string,"provider_event_id": string,"purge_after": string,"raw_mime"?: string | null,"received_at": string,"status"?: string,"tenant_id": string
                  }
                  Update: {
                    "attempts"?: number,"channel_account_id"?: string,"id"?: never,"kind"?: string,"last_error"?: string | null,"payload"?: Json | null,"processed_at"?: string | null,"provider"?: string,"provider_event_id"?: string,"purge_after"?: string,"raw_mime"?: string | null,"received_at"?: string,"status"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inbound_events_tenant_id_channel_account_id_fkey"
      columns: ["tenant_id","channel_account_id"]
isOneToOne: false
      referencedRelation: "channel_accounts"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "inbound_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "inbound_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_events": {
                  Row: {
                    "created_at": string,"id": number,"idempotency_key": string | null,"invoice_id": string,"payload": NonNullable<Json>,"tenant_id": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"idempotency_key"?: string | null,"invoice_id": string,"payload"?: NonNullable<Json>,"tenant_id": string,"type": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"idempotency_key"?: string | null,"invoice_id"?: string,"payload"?: NonNullable<Json>,"tenant_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "invoice_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_events_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id"]
    },{
      foreignKeyName: "invoice_events_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "invoice_events_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices_due"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "amount_total": number,"created_at": string,"currency": string,"customer_id": string,"due_on": string,"enqueued_at": string | null,"id": string,"issued_on": string,"next_action_at": string,"number": string,"parked_reason": string | null,"policy_id": string | null,"promised_on": string | null,"reference_code": string,"status": string,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_total": number,"created_at"?: string,"currency": string,"customer_id": string,"due_on": string,"enqueued_at"?: string | null,"id"?: string,"issued_on": string,"next_action_at"?: string,"number": string,"parked_reason"?: string | null,"policy_id"?: string | null,"promised_on"?: string | null,"reference_code": string,"status"?: string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_total"?: number,"created_at"?: string,"currency"?: string,"customer_id"?: string,"due_on"?: string,"enqueued_at"?: string | null,"id"?: string,"issued_on"?: string,"next_action_at"?: string,"number"?: string,"parked_reason"?: string | null,"policy_id"?: string | null,"promised_on"?: string | null,"reference_code"?: string,"status"?: string,"tenant_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "invoices_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "invoices_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_tenant_id_policy_id_fkey"
      columns: ["tenant_id","policy_id"]
isOneToOne: false
      referencedRelation: "policies"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"role": string,"tenant_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"role": string,"tenant_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: string,"tenant_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "memberships_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"message_invoices": {
                  Row: {
                    "invoice_id": string,"message_id": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "invoice_id": string,"message_id": string,"tenant_id": string
                  }
                  Update: {
                    "invoice_id"?: string,"message_id"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_invoices_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "message_invoices_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "message_invoices_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id"]
    },{
      foreignKeyName: "message_invoices_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "message_invoices_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices_due"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "message_invoices_tenant_id_message_id_fkey"
      columns: ["tenant_id","message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "analysis": Json | null,"attachments": NonNullable<Json>,"attempt": number,"body": string | null,"body_new_text": string | null,"channel": string,"classify_latency_ms": number | null,"cost_minor": number,"created_at": string,"customer_id": string | null,"delivery_status": string | null,"delivery_status_at": string | null,"direction": string,"failed_reason": string | null,"id": string,"idempotency_key": string | null,"in_reply_to": string | null,"inbound_event_id": number | null,"matched_by": string | null,"model_id": string | null,"pending_since": string | null,"prefilter": string | null,"processed_at": string | null,"prompt_version": string | null,"provider_message_id": string | null,"provider_timestamp": string | null,"purpose": string,"received_at": string | null,"rfc_message_id": string | null,"send_state": string | null,"sender_ref": string | null,"sent_at": string | null,"step_id": string | null,"subject": string | null,"template_key": string | null,"tenant_id": string,"thread_refs": (string)[],"tokens_in": number | null,"tokens_out": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "analysis"?: Json | null,"attachments"?: NonNullable<Json>,"attempt"?: number,"body"?: string | null,"body_new_text"?: string | null,"channel": string,"classify_latency_ms"?: number | null,"cost_minor"?: number,"created_at"?: string,"customer_id"?: string | null,"delivery_status"?: string | null,"delivery_status_at"?: string | null,"direction": string,"failed_reason"?: string | null,"id"?: string,"idempotency_key"?: string | null,"in_reply_to"?: string | null,"inbound_event_id"?: number | null,"matched_by"?: string | null,"model_id"?: string | null,"pending_since"?: string | null,"prefilter"?: string | null,"processed_at"?: string | null,"prompt_version"?: string | null,"provider_message_id"?: string | null,"provider_timestamp"?: string | null,"purpose"?: string,"received_at"?: string | null,"rfc_message_id"?: string | null,"send_state"?: string | null,"sender_ref"?: string | null,"sent_at"?: string | null,"step_id"?: string | null,"subject"?: string | null,"template_key"?: string | null,"tenant_id": string,"thread_refs"?: (string)[],"tokens_in"?: number | null,"tokens_out"?: number | null
                  }
                  Update: {
                    "analysis"?: Json | null,"attachments"?: NonNullable<Json>,"attempt"?: number,"body"?: string | null,"body_new_text"?: string | null,"channel"?: string,"classify_latency_ms"?: number | null,"cost_minor"?: number,"created_at"?: string,"customer_id"?: string | null,"delivery_status"?: string | null,"delivery_status_at"?: string | null,"direction"?: string,"failed_reason"?: string | null,"id"?: string,"idempotency_key"?: string | null,"in_reply_to"?: string | null,"inbound_event_id"?: number | null,"matched_by"?: string | null,"model_id"?: string | null,"pending_since"?: string | null,"prefilter"?: string | null,"processed_at"?: string | null,"prompt_version"?: string | null,"provider_message_id"?: string | null,"provider_timestamp"?: string | null,"purpose"?: string,"received_at"?: string | null,"rfc_message_id"?: string | null,"send_state"?: string | null,"sender_ref"?: string | null,"sent_at"?: string | null,"step_id"?: string | null,"subject"?: string | null,"template_key"?: string | null,"tenant_id"?: string,"thread_refs"?: (string)[],"tokens_in"?: number | null,"tokens_out"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_inbound_event_fk"
      columns: ["tenant_id","inbound_event_id"]
isOneToOne: false
      referencedRelation: "inbound_events"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "messages_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "messages_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "messages_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"dedupe_key": string,"id": string,"kind": string,"period": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at": string,"dedupe_key": string,"id"?: string,"kind": string,"period": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"dedupe_key"?: string,"id"?: string,"kind"?: string,"period"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "notifications_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_accounts": {
                  Row: {
                    "api_key_secret_id": string | null,"created_at": string,"enabled": boolean,"id": string,"mode": string,"provider": string,"tenant_id": string,"webhook_secret_id": string | null,"webhook_token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "api_key_secret_id"?: string | null,"created_at"?: string,"enabled"?: boolean,"id"?: string,"mode": string,"provider": string,"tenant_id": string,"webhook_secret_id"?: string | null,"webhook_token_hash": string
                  }
                  Update: {
                    "api_key_secret_id"?: string | null,"created_at"?: string,"enabled"?: boolean,"id"?: string,"mode"?: string,"provider"?: string,"tenant_id"?: string,"webhook_secret_id"?: string | null,"webhook_token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_accounts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "payment_accounts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_events": {
                  Row: {
                    "attempts": number,"event": NonNullable<Json>,"id": number,"kind": string,"last_error": string | null,"payment_account_id": string | null,"processed_at": string | null,"provider": string,"provider_event_id": string,"purge_after": string,"raw": Json | null,"received_at": string,"status": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"event": NonNullable<Json>,"id"?: never,"kind": string,"last_error"?: string | null,"payment_account_id"?: string | null,"processed_at"?: string | null,"provider": string,"provider_event_id": string,"purge_after": string,"raw"?: Json | null,"received_at": string,"status"?: string,"tenant_id": string
                  }
                  Update: {
                    "attempts"?: number,"event"?: NonNullable<Json>,"id"?: never,"kind"?: string,"last_error"?: string | null,"payment_account_id"?: string | null,"processed_at"?: string | null,"provider"?: string,"provider_event_id"?: string,"purge_after"?: string,"raw"?: Json | null,"received_at"?: string,"status"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "payment_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_events_tenant_id_payment_account_id_fkey"
      columns: ["tenant_id","payment_account_id"]
isOneToOne: false
      referencedRelation: "payment_accounts"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"payment_proofs": {
                  Row: {
                    "created_at": string,"customer_id": string | null,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"duplicate_of": string | null,"hints": NonNullable<Json>,"hints_model_id": string | null,"hints_prompt_version": string | null,"id": string,"invoice_id": string | null,"message_id": string | null,"mime": string,"original_name": string | null,"receipt_id": string | null,"sha256": string,"size_bytes": number,"status": string,"storage_path": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at": string,"customer_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"duplicate_of"?: string | null,"hints"?: NonNullable<Json>,"hints_model_id"?: string | null,"hints_prompt_version"?: string | null,"id"?: string,"invoice_id"?: string | null,"message_id"?: string | null,"mime": string,"original_name"?: string | null,"receipt_id"?: string | null,"sha256": string,"size_bytes": number,"status"?: string,"storage_path": string,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"duplicate_of"?: string | null,"hints"?: NonNullable<Json>,"hints_model_id"?: string | null,"hints_prompt_version"?: string | null,"id"?: string,"invoice_id"?: string | null,"message_id"?: string | null,"mime"?: string,"original_name"?: string | null,"receipt_id"?: string | null,"sha256"?: string,"size_bytes"?: number,"status"?: string,"storage_path"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_proofs_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "payment_proofs_tenant_id_duplicate_of_fkey"
      columns: ["tenant_id","duplicate_of"]
isOneToOne: false
      referencedRelation: "payment_proofs"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "payment_proofs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "payment_proofs_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_proofs_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id"]
    },{
      foreignKeyName: "payment_proofs_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "payment_proofs_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices_due"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "payment_proofs_tenant_id_message_id_fkey"
      columns: ["tenant_id","message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "payment_proofs_tenant_id_receipt_id_fkey"
      columns: ["tenant_id","receipt_id"]
isOneToOne: false
      referencedRelation: "receipts"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"payment_requests": {
                  Row: {
                    "amount": number,"created_at": string,"currency": string,"deactivated_at": string | null,"deactivation_reason": string | null,"expires_at": string | null,"id": string,"idempotency_key": string,"invoice_id": string,"payment_account_id": string | null,"provider": string,"provider_deactivated_at": string | null,"provider_object_id": string | null,"status": string,"tenant_id": string,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"created_at": string,"currency": string,"deactivated_at"?: string | null,"deactivation_reason"?: string | null,"expires_at"?: string | null,"id"?: string,"idempotency_key": string,"invoice_id": string,"payment_account_id"?: string | null,"provider": string,"provider_deactivated_at"?: string | null,"provider_object_id"?: string | null,"status"?: string,"tenant_id": string,"url"?: string | null
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string,"currency"?: string,"deactivated_at"?: string | null,"deactivation_reason"?: string | null,"expires_at"?: string | null,"id"?: string,"idempotency_key"?: string,"invoice_id"?: string,"payment_account_id"?: string | null,"provider"?: string,"provider_deactivated_at"?: string | null,"provider_object_id"?: string | null,"status"?: string,"tenant_id"?: string,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_requests_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "payment_requests_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_requests_tenant_id_invoice_id_currency_fkey"
      columns: ["tenant_id","invoice_id","currency"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id","currency"]
    },{
      foreignKeyName: "payment_requests_tenant_id_invoice_id_currency_fkey"
      columns: ["tenant_id","invoice_id","currency"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id","currency"]
    },{
      foreignKeyName: "payment_requests_tenant_id_payment_account_id_fkey"
      columns: ["tenant_id","payment_account_id"]
isOneToOne: false
      referencedRelation: "payment_accounts"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"confirmed_by": string | null,"created_at": string,"currency": string,"id": string,"invoice_id": string,"method": string,"paid_at": string,"provider_ref": string,"receipt_id": string | null,"source": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"confirmed_by"?: string | null,"created_at"?: string,"currency": string,"id"?: string,"invoice_id": string,"method": string,"paid_at": string,"provider_ref": string,"receipt_id"?: string | null,"source"?: string,"tenant_id": string
                  }
                  Update: {
                    "amount"?: number,"confirmed_by"?: string | null,"created_at"?: string,"currency"?: string,"id"?: string,"invoice_id"?: string,"method"?: string,"paid_at"?: string,"provider_ref"?: string,"receipt_id"?: string | null,"source"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_receipt_fk"
      columns: ["tenant_id","receipt_id"]
isOneToOne: false
      referencedRelation: "receipts"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "payments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "payments_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_tenant_id_invoice_id_currency_fkey"
      columns: ["tenant_id","invoice_id","currency"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id","currency"]
    },{
      foreignKeyName: "payments_tenant_id_invoice_id_currency_fkey"
      columns: ["tenant_id","invoice_id","currency"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id","currency"]
    }
                  ]
                },"policies": {
                  Row: {
                    "created_at": string,"escalate_after_days": number,"grace_days_after_promise": number,"id": string,"is_default": boolean,"max_messages_per_week": number,"name": string,"steps": NonNullable<Json>,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"escalate_after_days"?: number,"grace_days_after_promise"?: number,"id"?: string,"is_default"?: boolean,"max_messages_per_week"?: number,"name": string,"steps": NonNullable<Json>,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"escalate_after_days"?: number,"grace_days_after_promise"?: number,"id"?: string,"is_default"?: boolean,"max_messages_per_week"?: number,"name"?: string,"steps"?: NonNullable<Json>,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "policies_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "policies_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"promises": {
                  Row: {
                    "created_at": string,"customer_id": string,"id": string,"invoice_id": string,"promised_on": string,"reference_at": string,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"source_message_id": string | null,"status": string,"superseded_by": string | null,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id": string,"id"?: string,"invoice_id": string,"promised_on": string,"reference_at": string,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source_message_id"?: string | null,"status"?: string,"superseded_by"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string,"id"?: string,"invoice_id"?: string,"promised_on"?: string,"reference_at"?: string,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source_message_id"?: string | null,"status"?: string,"superseded_by"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "promises_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "promises_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "promises_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "promises_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id"]
    },{
      foreignKeyName: "promises_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "promises_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices_due"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "promises_tenant_id_source_message_id_fkey"
      columns: ["tenant_id","source_message_id"]
isOneToOne: true
      referencedRelation: "messages"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "promises_tenant_id_superseded_by_fkey"
      columns: ["tenant_id","superseded_by"]
isOneToOne: false
      referencedRelation: "promises"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"receipts": {
                  Row: {
                    "amount": number,"confirmed_by": string | null,"created_at": string,"currency": string,"customer_id": string,"id": string,"invoice_id": string,"method": string,"note": string | null,"payment_event_id": number | null,"proof_id": string | null,"provider_ref": string,"received_at": string,"source": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"confirmed_by"?: string | null,"created_at"?: string,"currency": string,"customer_id": string,"id"?: string,"invoice_id": string,"method": string,"note"?: string | null,"payment_event_id"?: number | null,"proof_id"?: string | null,"provider_ref": string,"received_at": string,"source": string,"tenant_id": string
                  }
                  Update: {
                    "amount"?: number,"confirmed_by"?: string | null,"created_at"?: string,"currency"?: string,"customer_id"?: string,"id"?: string,"invoice_id"?: string,"method"?: string,"note"?: string | null,"payment_event_id"?: number | null,"proof_id"?: string | null,"provider_ref"?: string,"received_at"?: string,"source"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "receipts_payment_event_fk"
      columns: ["tenant_id","payment_event_id"]
isOneToOne: false
      referencedRelation: "payment_events"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "receipts_proof_fk"
      columns: ["tenant_id","proof_id"]
isOneToOne: false
      referencedRelation: "payment_proofs"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "receipts_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "receipts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "receipts_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "receipts_tenant_id_invoice_id_currency_fkey"
      columns: ["tenant_id","invoice_id","currency"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id","currency"]
    },{
      foreignKeyName: "receipts_tenant_id_invoice_id_currency_fkey"
      columns: ["tenant_id","invoice_id","currency"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id","currency"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "assignee": string | null,"block_expiry_alerted": boolean,"blocks_reminders_until": string | null,"created_at": string,"customer_id": string | null,"dedupe_key": string,"details": NonNullable<Json>,"draft_reply": string | null,"id": string,"invoice_id": string | null,"message_id": string | null,"reason": string | null,"receipt_id": string | null,"resolution_note": string | null,"resolved_at": string | null,"resolved_by": string | null,"status": string,"tenant_id": string,"type": string,"urgent": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee"?: string | null,"block_expiry_alerted"?: boolean,"blocks_reminders_until"?: string | null,"created_at": string,"customer_id"?: string | null,"dedupe_key": string,"details"?: NonNullable<Json>,"draft_reply"?: string | null,"id"?: string,"invoice_id"?: string | null,"message_id"?: string | null,"reason"?: string | null,"receipt_id"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"tenant_id": string,"type": string,"urgent"?: boolean
                  }
                  Update: {
                    "assignee"?: string | null,"block_expiry_alerted"?: boolean,"blocks_reminders_until"?: string | null,"created_at"?: string,"customer_id"?: string | null,"dedupe_key"?: string,"details"?: NonNullable<Json>,"draft_reply"?: string | null,"id"?: string,"invoice_id"?: string | null,"message_id"?: string | null,"reason"?: string | null,"receipt_id"?: string | null,"resolution_note"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"tenant_id"?: string,"type"?: string,"urgent"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_receipt_fk"
      columns: ["tenant_id","receipt_id"]
isOneToOne: false
      referencedRelation: "receipts"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "tasks_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "tasks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "tasks_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoice_balances"
      referencedColumns: ["tenant_id","invoice_id"]
    },{
      foreignKeyName: "tasks_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "tasks_tenant_id_invoice_id_fkey"
      columns: ["tenant_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices_due"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "tasks_tenant_id_message_id_fkey"
      columns: ["tenant_id","message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"templates": {
                  Row: {
                    "body": string,"channel": string,"id": string,"locale": string,"provider_language": string | null,"provider_status": string | null,"provider_template_name": string | null,"subject": string | null,"template_key": string,"tenant_id": string,"tone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"channel": string,"id"?: string,"locale"?: string,"provider_language"?: string | null,"provider_status"?: string | null,"provider_template_name"?: string | null,"subject"?: string | null,"template_key": string,"tenant_id": string,"tone": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"channel"?: string,"id"?: string,"locale"?: string,"provider_language"?: string | null,"provider_status"?: string | null,"provider_template_name"?: string | null,"subject"?: string | null,"template_key"?: string,"tenant_id"?: string,"tone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "templates_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "templates_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tenant_events": {
                  Row: {
                    "created_at": string,"customer_id": string | null,"id": number,"idempotency_key": string,"message_id": string | null,"payload": NonNullable<Json>,"tenant_id": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id"?: string | null,"id"?: never,"idempotency_key": string,"message_id"?: string | null,"payload"?: NonNullable<Json>,"tenant_id": string,"type": string
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string | null,"id"?: never,"idempotency_key"?: string,"message_id"?: string | null,"payload"?: NonNullable<Json>,"tenant_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tenant_events_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "tenant_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "tenant_events_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tenant_events_tenant_id_message_id_fkey"
      columns: ["tenant_id","message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["tenant_id","id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "approval_mode": string,"bank_instructions": string | null,"classification_daily_cap": number,"created_at": string,"currency": string,"id": string,"monthly_message_budget_minor": number,"name": string,"outbound_paused": boolean,"promise_acceptance": string,"proof_ai_extraction": boolean,"proof_storage_cap_bytes": number,"quiet_end_hour": number,"quiet_start_hour": number,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approval_mode"?: string,"bank_instructions"?: string | null,"classification_daily_cap"?: number,"created_at"?: string,"currency": string,"id"?: string,"monthly_message_budget_minor"?: number,"name": string,"outbound_paused"?: boolean,"promise_acceptance"?: string,"proof_ai_extraction"?: boolean,"proof_storage_cap_bytes"?: number,"quiet_end_hour"?: number,"quiet_start_hour"?: number,"timezone": string
                  }
                  Update: {
                    "approval_mode"?: string,"bank_instructions"?: string | null,"classification_daily_cap"?: number,"created_at"?: string,"currency"?: string,"id"?: string,"monthly_message_budget_minor"?: number,"name"?: string,"outbound_paused"?: boolean,"promise_acceptance"?: string,"proof_ai_extraction"?: boolean,"proof_storage_cap_bytes"?: number,"quiet_end_hour"?: number,"quiet_start_hour"?: number,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "invoice_balances": {
                  Row: {
                    "amount_paid": number | null,"amount_total": number,"balance": number | null,"currency": string,"invoice_id": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "invoices_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "invoices_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"invoices_due": {
                  Row: {
                    "id": string,"next_action_at": string,"status": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "invoices_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "kpi_this_week"
      referencedColumns: ["tenant_id"]
    },{
      foreignKeyName: "invoices_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"kpi_ageing_now": {
                  Row: {
                    "balance": number | null,"bucket": string | null,"currency": string | null,"invoices": number | null,"tenant_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"kpi_overdue_now": {
                  Row: {
                    "balance": number | null,"currency": string | null,"invoices": number | null,"tenant_id": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"kpi_this_week": {
                  Row: {
                    "tenant_id": string,"week_end": string | null,"week_start": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "cancel_promise":
{ Args: { "p_note"?: string,"p_promise_id": string }; Returns: string
                           },
"commit_import_batch":
{ Args: { "p_batch_id": string,"p_dry_run"?: boolean,"p_skip_invalid_rows"?: boolean }; Returns: Json
                           },
"create_tenant":
{ Args: { "p_currency": string,"p_name": string,"p_quiet_end_hour"?: number,"p_quiet_start_hour"?: number,"p_timezone": string }; Returns: string
                           },
"decide_approval":
{ Args: { "p_approval_id": string,"p_decision": string,"p_note"?: string }; Returns: string
                           },
"edit_approval":
{ Args: { "p_approval_id": string,"p_body": string,"p_subject": string }; Returns: undefined
                           },
"kpi_ageing":
{ Args: { "p_as_of"?: string }; Returns: {
              "balance": number,"bucket": string,"currency": string,"invoices": number,"tenant_id": string
            }[]
                           },
"kpi_days_to_pay":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "avg_days_after_due": number,"avg_days_to_pay": number,"invoices": number,"tenant_id": string
            }[]
                           },
"kpi_messages":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "channel": string,"cost_minor": number,"purpose": string,"sent": number,"tenant_id": string
            }[]
                           },
"kpi_overdue_total":
{ Args: { "p_as_of"?: string }; Returns: {
              "balance": number,"currency": string,"invoices": number,"tenant_id": string
            }[]
                           },
"kpi_promise_kept_rate":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "broken": number,"kept": number,"rate": number,"tenant_id": string
            }[]
                           },
"kpi_recovered":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "credit": number,"currency": string,"receipts": number,"recovered": number,"tenant_id": string
            }[]
                           },
"reopen_task":
{ Args: { "p_note"?: string,"p_task_id": string }; Returns: string
                           },
"resolve_task":
{ Args: { "p_note": string,"p_task_id": string }; Returns: string
                           },
"set_outbound_paused":
{ Args: { "p_paused": boolean,"p_tenant_id": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
