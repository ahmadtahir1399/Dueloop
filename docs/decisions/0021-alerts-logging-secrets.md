# 0021: Alerts, logging and secrets

**Decision.**
- Alerts are de-duplicated in `public.notifications`, unique per tenant, dedupe key and period. The
  period is `once` for a parked invoice or an unknown message, and the day for recurring causes. A notifier
  that throws never fails a job.
- Delivery: always the JSON log, plus Slack when the tenant has a webhook secret. Alerts carry ids, invoice
  numbers and reason codes only.
- The JSON logger writes only an allowlist of fields (`LOG_FIELDS`) and redacts anything that looks like
  an email address or a phone number. Message bodies and contact details are never logged (rule 20).
- Secrets (the SMTP password, the WhatsApp token, the Slack webhook URL) live in Supabase Vault. They are
  read through `private.channel_secret()` at send time only, and never appear in config, events,
  payloads, dead letters, logs or error strings (rule 19).
- Tenant-chosen SMTP hosts are ignored unless `SMTP_ALLOW_TENANT_HOST=true`. By default the operator relay
  (`SMTP_HOST`) is used, so channel-account config cannot be used for SSRF.
