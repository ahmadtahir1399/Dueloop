# 0042: Role matrix for the web app, as data (prompt 6)

**Context.** The dashboard gates screens and buttons by role. ADRs 0008, 0012, 0022 and 0032 fixed the database
side table by table. A UI that keeps its own copy of "who may do what" drifts. Rule 33: the UI hides, the DB
decides.

**Decision.** `packages/authz` holds the matrix as data (`PERMISSIONS`). The web app's navigation and buttons
call `can(role, id)`; the bypass tests call each RPC with each role's token and compare the result with this
table; `packages/authz/test/matrix.test.ts` fails unless the table below is byte-identical to
`matrixMarkdown()`. Changing a cell means changing the data, this table and the database check together.

| Permission | owner | accountant | collector |
|---|---|---|---|
| `overview.view` | yes | yes | yes |
| `invoices.view` | yes | yes | yes |
| `customers.view` | yes | yes | yes |
| `inbox.view` | yes | yes | yes |
| `approvals.view` | yes | yes | yes |
| `approvals.decide` | yes | yes | no |
| `tasks.view` | yes | yes | yes |
| `tasks.resolve` | yes | yes | yes |
| `promises.cancel` | yes | yes | no |
| `proofs.view` | yes | yes | yes |
| `proofs.decide` | yes | yes | no |
| `payments.record` | yes | yes | no |
| `messages.reconcile` | yes | yes | no |
| `import.run` | yes | yes | no |
| `export.lists` | yes | yes | yes |
| `export.audit` | yes | yes | no |
| `killswitch.toggle` | yes | no | no |
| `settings.view` | yes | yes | yes |
| `settings.edit` | yes | no | no |
| `policies.edit` | yes | yes | no |
| `templates.edit` | yes | yes | no |
| `holidays.edit` | yes | yes | no |
| `members.view` | yes | yes | yes |
| `members.manage` | yes | no | no |
| `integrations.view` | yes | yes | no |
| `integrations.manage` | yes | no | no |
| `webhook_urls.view` | yes | no | no |
| `api_keys.manage` | yes | no | no |

- **Ambiguous cells decided here** (prompt 6 "stop and ask" list; recorded as DECISIONS NEEDED in the report):
  list exports are open to every member (they can read the same rows on screen); the audit export is owner and
  accountant; reconciling an unknown message is owner and accountant (same as approving a send, ADR 0012);
  webhook URLs are owner only (they carry an opaque token, ADR 0037).
- Every mutation is re-checked inside the database: RLS for direct table writes, a role check inside each
  security-definer RPC, and for the money pipeline (`apply_payment`) a membership check on the confirming user.
  The web app derives that user from the verified session, never from the form.
- Viewing is RLS. A screen a role may not see is hidden from the nav and answers 404 (not 403), so a URL does not
  confirm that an object exists.

**Consequences.** The matrix is one place to read. A cell that the UI allows but the database denies is caught by
the bypass tests in `apps/web/e2e` and `supabase/tests`.
