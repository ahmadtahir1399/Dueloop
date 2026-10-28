# 0049: Policy, template, settings and member editors (prompt 6, issues K, L, M, N)

**Decision.**
- **Policies (K).** Step ids are system-generated (`s_<10 hex>`), immutable and never reused (`retired_step_ids`).
  Users edit days, channel and template; a step can be removed (its id is retired). Labels are NOT supported: the
  step schema is strict (`packages/db` zod) and adding a field would change prompt 1-5 data (deviation). Writes go
  through `save_policy` (owner/accountant); a trigger stops any client write to `steps` outside it. In the same
  transaction, the policy's non-final, non-parked invoices get `next_action_at = now`, so `decide()` re-evaluates
  them; sent steps are remembered by id and are never sent again. The editor first shows the impact (count) and a
  "what would happen" preview: core `decide()` with an injected clock on up to 5 real invoices with the edited policy.
- **Templates (L).** Preview uses the production renderer (`render`: unknown/missing variables refused) and the
  footer is shown appended, read-only. A WhatsApp body edit sets `provider_status = 'needs_resubmission'` (trigger);
  the router already refuses any WhatsApp template that is not `approved`; only an owner sets it back
  (`set_template_provider_status`). Prompt 3's wording list is shown as a warning, "not legal advice".
- **Settings.** Owner only (`save_tenant_settings`), validated by core `validateSettings` in the action (IANA zone,
  quiet hours incl. non-wrapping windows) and by the database. The AI-proof toggle explains the data flow.
- **Members (M).** Last-owner trigger with a tenant row lock (concurrent demotions tested). Invites: Supabase Auth
  admin `inviteUserByEmail`, server-side after an owner check in the database; an address that already has an
  account is added without an email; the answer is the same in both cases (no account enumeration).
- **Secrets (N).** Channel and payment secrets go to Vault through prompt 3/5 functions; the UI shows "set/missing"
  only. Webhook URLs (opaque token) are shown once, to an owner, on connect or rotation.
