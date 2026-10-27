
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "customers": {
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
      referencedRelation: "tenants"
      referencedColumns: ["id"]
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
                    "amount_total": number,"created_at": string,"currency": string,"customer_id": string,"due_on": string,"enqueued_at": string | null,"id": string,"issued_on": string,"next_action_at": string,"number": string,"policy_id": string | null,"promised_on": string | null,"reference_code": string,"status": string,"tenant_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_total": number,"created_at"?: string,"currency": string,"customer_id": string,"due_on": string,"enqueued_at"?: string | null,"id"?: string,"issued_on": string,"next_action_at"?: string,"number": string,"policy_id"?: string | null,"promised_on"?: string | null,"reference_code": string,"status"?: string,"tenant_id": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_total"?: number,"created_at"?: string,"currency"?: string,"customer_id"?: string,"due_on"?: string,"enqueued_at"?: string | null,"id"?: string,"issued_on"?: string,"next_action_at"?: string,"number"?: string,"policy_id"?: string | null,"promised_on"?: string | null,"reference_code"?: string,"status"?: string,"tenant_id"?: string,"updated_at"?: string
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
                    "analysis": Json | null,"body": string | null,"channel": string,"created_at": string,"customer_id": string,"delivery_status": string | null,"direction": string,"id": string,"idempotency_key": string | null,"provider_message_id": string | null,"template_key": string | null,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "analysis"?: Json | null,"body"?: string | null,"channel": string,"created_at"?: string,"customer_id": string,"delivery_status"?: string | null,"direction": string,"id"?: string,"idempotency_key"?: string | null,"provider_message_id"?: string | null,"template_key"?: string | null,"tenant_id": string
                  }
                  Update: {
                    "analysis"?: Json | null,"body"?: string | null,"channel"?: string,"created_at"?: string,"customer_id"?: string,"delivery_status"?: string | null,"direction"?: string,"id"?: string,"idempotency_key"?: string | null,"provider_message_id"?: string | null,"template_key"?: string | null,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_tenant_id_customer_id_fkey"
      columns: ["tenant_id","customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["tenant_id","id"]
    },{
      foreignKeyName: "messages_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"confirmed_by": string | null,"created_at": string,"currency": string,"id": string,"invoice_id": string,"method": string,"paid_at": string,"provider_ref": string,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"confirmed_by"?: string | null,"created_at"?: string,"currency": string,"id"?: string,"invoice_id": string,"method": string,"paid_at": string,"provider_ref": string,"tenant_id": string
                  }
                  Update: {
                    "amount"?: number,"confirmed_by"?: string | null,"created_at"?: string,"currency"?: string,"id"?: string,"invoice_id"?: string,"method"?: string,"paid_at"?: string,"provider_ref"?: string,"tenant_id"?: string
                  }
                  Relationships: [
                    {
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
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "approval_mode": string,"created_at": string,"currency": string,"id": string,"monthly_message_budget_minor": number,"name": string,"outbound_paused": boolean,"quiet_end_hour": number,"quiet_start_hour": number,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approval_mode"?: string,"created_at"?: string,"currency": string,"id"?: string,"monthly_message_budget_minor"?: number,"name": string,"outbound_paused"?: boolean,"quiet_end_hour"?: number,"quiet_start_hour"?: number,"timezone": string
                  }
                  Update: {
                    "approval_mode"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"monthly_message_budget_minor"?: number,"name"?: string,"outbound_paused"?: boolean,"quiet_end_hour"?: number,"quiet_start_hour"?: number,"timezone"?: string
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
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            [_ in never]: never
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
