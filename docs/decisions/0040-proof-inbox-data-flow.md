# 0040: Proof-of-payment inbox and its data flow (prompt 5, issue M)

**Context.** Customers send screenshots and PDFs. These are PII (account numbers, names) and attacker-controlled
input.

**Decision.**
- Trigger: a `proof_fetch` job is queued only when an inbound message with image or PDF attachments is LINKED
  to an invoice, in the same transaction as the link. Unmatched messages are never fetched (rule 24).
- Fetch: email from the stored raw message; WhatsApp through the Cloud API media endpoints (URL valid for 5
  minutes, media id for 7 days), with Bearer auth, at processing time.
- Validate before storing or sending anywhere: magic bytes decide (JPEG, PNG, WebP, PDF only), dimensions come
  from headers (at most 10,000 px per side and 40 MP), and truncated files, appended data, embedded archives or
  markup, and active PDFs (JavaScript, launch actions, embedded files) are rejected. A rejected file becomes a
  review task; it is not stored. Known limit: a ZIP signature occurring by chance inside image data causes a
  false rejection, which a human sees.
- Storage: private bucket, `<tenant>/<proof id>`, ids derived from (message, attachment). The original name is
  sanitised and shown, never used as a path. Exact sha256 duplicates are flagged tenant-wide. Re-encoded
  screenshots are NOT detected (no perceptual hash).
- Caps: 5 per message, 10 per customer per local day, and a per-tenant byte total. Over a cap creates a
  `proof_limit_reached` task, never a silent drop.
- AI hints are OFF by default (`tenants.proof_ai_extraction`). When a tenant opts in, the image (never a PDF,
  never a duplicate) goes to the configured model. The output is limited to four nullable text fields, which
  code parses and labels UNTRUSTED. Hints are never defaults for `confirm`. Accuracy is NOT measured.
