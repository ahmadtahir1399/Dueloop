# Prompt 7 report: packaging, operations, release

Branch `claude/invoice-followup-dashboard-api-58dd61`, commits a9eb2b2 .. HEAD. One Windows 10 machine (15.7 GB RAM,
Docker Desktop, Engine 29.8.0) against the local Supabase CLI stack. Nothing was pushed, tagged, published or made
public.

Preconditions, recorded instead of stopping (you asked me not to wait for answers): prompt 6 is not merged to main
(it is on this branch); Docker had to be started; every fact slot (project name, licence, contribution policy,
security contact, repo URL, support terms, where the repo is) was blank; the earlier reports' open decisions and the
prompt 6 handoff were not pasted (the repository was used; prompt 6's report is docs/reports/prompt-6-report.md);
`docs/build-guide.md` does not exist here, so nothing from the guide could be read.

## 1. Built

- packages/config: typed env schema; `.env.example` and docs/env-reference.md generated; `pnpm env:example|env:check`.
- packages/ops: schema guard (`assertSchema`), heartbeats, `ops:status`, `ops:watchdog`, `doctor`, `ops alive`,
  container healthcheck, error reporter + scrubber, retention/export/erase CLIs, pilot report and CLIs,
  `backup:drill`, `post-restore.sql`, `images:build|smoke`.
- Migrations 0021 (ops), 0022 (retention, erasure, suppression), 0023 (KPI snapshots).
- packages/repo-tools: `repo:audit`, `verify:all`, `docs:check`, `egress:check`, `licences:report`;
  packages/db `db:catalog-audit`.
- packages/demo: `demo`, `demo:control`, `demo:selftest`, `demo:stop`, `demo:reset`, `demo:logs`, `demo:record`.
- Dockerfile (targets `services`, `web`), `.dockerignore`, `compose.selfhost.yml`.
- Workflows: `clean-clone.yml`, `release.yml`, ci.yml additions; `.github/dependabot.yml`; issue/PR templates.
- Docs: architecture, self-hosting, env-reference, runbook, data-handling, security-review, threat-model, limitations,
  demo-script, pilot-playbook, client-onboarding, release, public-repo-checklist, decisions index, ADRs 0051-0052,
  measurements; README, CHANGELOG, SECURITY, CONTRIBUTING. CLAUDE.md rules 41-46.

## 2. Commands run

Clean clone of commit c06fb99 into `.demo/cc` (a scratchpad path was too long for Windows process creation), then:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 (7 s with a warm pnpm store; the first clone took 88 s) |
| `pnpm exec supabase start` | exit 0 (28 s, images cached) |
| `pnpm verify:all` | 28 of 30 steps PASS in 1338 s; step 29 (images) failed on a registry timeout and was re-run after the fix; then steps 29-30 PASS (see below). All 30 steps have passed in this clean clone |

Per step (seconds): lint 5, typecheck 46, unit 28 (39 files / 698 tests), env check 1, repo audit 3, docs check 2,
egress check 1, simulator 3, database tests 161 (pgTAP 1708 + integration 159, incl. chaos), RLS check 3, types
current 2, doctor + ops status 2, import twice 32, adversarial 15, load 249, classifier eval 2, demo send 50, demo
replies 64, demo payments 78, integrity 2, backup drill 125, web build 16, e2e staff 113 (99 tests), security 54,
a11y 64, low bandwidth 53, e2e demo 86 (every step PASS), perf pages 59.

The first clean-clone run (commit e3be840) failed in the database step: it found contact details in an event row
(finding F13, fixed test-first in c06fb99). The image step then failed on a registry timeout; the Dockerfile now
fetches pnpm in a cached layer (d057c73) and the last two steps were re-run in the same clone:
`pnpm verify:all --from "container images: build + smoke"` at d057c73: images build + smoke PASS (511 s: build 438 s, all four
services ready in 6 s, 8 approvals -> 8 sent -> 8 emails, no leftover containers, image scans clean); demo contract
PASS (88 s: `pnpm demo --non-interactive`, `pnpm demo:selftest` 13/13, `pnpm demo:stop`). Exit 0.

Also run in this session: `pnpm repo:audit` (11 checks + dependency check, history 72 commits clean, planted secret
found), `pnpm db:catalog-audit` (35 findings, all accepted with reasons; a probe table made it fail), `pnpm
licences:report` (497 packages), `pnpm demo --non-interactive` + `demo:selftest` (13/13) + `demo:stop` (nothing
left), `pnpm demo:record` (passed, 11 pages leak-checked, no findings), `pnpm pilot:snapshot|report`.

## 3. Versions

Node 24.19.0; pnpm 12.15.0; Docker Engine 29.8.0, buildx 0.37.0 (Docker Desktop, Windows); Supabase CLI 2.122.0;
Postgres image public.ecr.aws/supabase/postgres:17.11.0.006 (with storage-api v1.84.19, gotrue v2.197.0, postgrest
v16.5, kong 2.8.1, mailpit v1.31.3); base image node:24.19.0-bookworm-slim@sha256:a9f5f7c9...29df; Playwright
1.64.1 (Chromium); Next.js 16.4.3. Scanners: own pattern-based secret scanner (repo-tools; no binary download,
cross-platform, proven by a planted secret); licences: own reporter over `pnpm list --prod` (`pnpm licenses list`
returned nothing under pnpm 12.15.0); link checker: `docs:check`, relative links only (offline); container
vulnerability scanner: none; demo process runner: Node `spawn` detached + pid file, `taskkill /T` on Windows,
process groups elsewhere.

## 4. Issues A-P

| Issue | Confirmed | Evidence | Commit |
|---|---|---|---|
| A one command hides prerequisites | yes | demo preflight (versions, Docker, ports, disk/RAM from a measured run, network only when images are missing) | 923bcc5 |
| B demo credentials | yes | seed users cannot sign in; demo logins created per run with random passwords, never stored; `demo/test/safety.test.ts` (no migration or seed passwords) | 923bcc5 |
| C demo vs time | yes, and found again in the e2e demo (tenant zone vs injected clock) | `demo:control run-cycle` uses `--now`; e2e demo asserts the tenant zone | 923bcc5, b6f2a37 |
| D licence | yes | no LICENSE file; comparison in section 9; licence report | 3903012 |
| E secrets in history | yes; history clean | repo:audit history scan + planted-secret proof | a9eb2b2 |
| F backups | yes, and worse than expected | backup drill: no migration history, queues, cron jobs, Vault rows or Storage files in a logical dump; the first three fixed by extra steps | 876de30 |
| G support/runbook | yes | runbook technical half complete, support half TODO | 876de30 |
| H claim creep | yes | claims audit in repo:audit | a9eb2b2 |
| I data handling from code | yes | docs/data-handling.md + `egress:check` | 3b6df4a |
| J retention/erasure | yes | migration 0022, CLIs, tests; erasure found not re-runnable and fixed | a9eb2b2 |
| K operational visibility | yes | heartbeats, watchdog, chaos test (kill the worker -> alert) | a9eb2b2 |
| L self-hosting | yes | Dockerfile, compose, images:smoke, docs/self-hosting.md | ba31a2e |
| M upgrades | yes | schema guard, forward-only policy, rollback stance | a9eb2b2, 876de30 |
| N the build guide | yes (absent) | docs/architecture.md written from code; decision listed | 3b6df4a |
| O the video can leak | yes | demo:record DOM leak check; human review required | b6f2a37 |
| P no pilot baseline | yes | migration 0023, pilot CLIs, hand-computed tests | 927f43d |

Defects found by the verification itself, all fixed with a failing test first or a reproducing run: stale queue
jobs sending the next step (84facfc, high), the drift test not knowing the 'web' channel (69fb511), the db package's
undeclared dependency (ba31a2e), provider error text with contact details in events (c06fb99), the perf seed
violating the invoice guard and ledger shape (a9eb2b2), the e2e demo's time-of-day dependence (b6f2a37), pnpm
downloaded after the source copy in the image (latest commit).

## 5. Timings

| Phase | Measured |
|---|---|
| `pnpm demo`, first start with the stack running, web build included | 52.9 s |
| `pnpm demo`, warm (stack running, build cached) | 37.1 s: preflight 1.3, stack check 1.1, reset + seed 28.6, services ready 6 |
| `pnpm install --frozen-lockfile` in a fresh clone | 88 s (first), 7 s (warm store) |
| `supabase start` with cached images | 27-28 s |
| `pnpm verify:all` from a clean clone | 1338 s for 28 steps (load test 249 s, DB tests 161 s, backup drill 125 s dominate) |
| Cold demo (no cached images, fresh machine) | NOT MEASURED: needs the clean-clone CI job, which has not run. The 15-minute gate is therefore not shown to be met or missed |

Resources (docs/measurements/demo-resources.txt): about 1.0 GB of memory in use (0.42 GB node processes, 0.59 GB
containers) and about 4.5 GB of disk; preflight requires 4 GB RAM and 6 GB free disk.

## 6. Security review summary

Full text: docs/security-review.md, docs/threat-model.md. Rules 1-46 are mapped to their enforcement; 8, 9, 10 and
part of 43 are convention only. Catalog audit: no table without RLS, no write policy without WITH CHECK, no view
bypassing RLS, no public bucket; 20 SECURITY DEFINER functions callable by authenticated and 15 default-privilege
entries, all accepted with reasons. Supply chain: one low `deepmerge` advisory via the shadcn CLI (accepted, no
patch); LGPL libvips in the web image (review). Findings: F1 high (fixed), F2 F3 F5 F7 F13 fixed, F4 Vault/Storage
not in backups (open), F6 accepted, F8 service key reads all Vault secrets (residual), F9 services need a
supervisor (open), F10 pattern-only secret scanning (open), F11 LGPL (decision), F12 nothing run on a real host
(open). History scan: 72 commits, all refs, clean; scanner proven on a planted secret.

## 7. Backup and restore drill

Restored a logical dump of the local stack into a fresh, empty second stack. Came back identical: all 39 tables in
`public` and `private` (row counts and checksums); ledger integrity clean. Did NOT come back with the documented
procedure: migration history (every service then refuses to start), all 5 pgmq queues, all 5 cron jobs, every Vault
secret (no Vault rows in the dump at all), Storage files (rows only; the file answered HTTP 500). Two extra dumps
plus `packages/ops/sql/post-restore.sql` bring back migration history, queues and schedules (verified). Vault secrets
and Storage files stay manual (runbook). Behaviour vs docs: the docs say backups hold only encrypted Vault data; the
CLI dump here held no Vault rows. Recorded as an observation, not a contradiction.

## 8. Platforms

Run on: Windows 10 Home 10.0.19045, Docker Desktop (Linux containers), Node 24.19.0, Chromium via Playwright.
NOT VERIFIED: Linux and macOS hosts, WSL2, the GitHub runners (no workflow has run), a real server, hosted Supabase.

## 9. Decisions needed

- **Licence (blank).** No LICENSE file was added. A neutral comparison, not legal advice:
  - MIT: short and permissive; anyone may use, change and sell the code, including in closed products, if they keep
    the notice. No explicit patent grant.
  - Apache-2.0: permissive like MIT, plus an explicit patent licence that ends for anyone who sues over patents, and
    rules for a NOTICE file. Common for projects that want companies to adopt them.
  - AGPL-3.0: strong copyleft that reaches network use: anyone who runs a modified version as a service must offer
    its source to its users. It discourages closed hosted forks of an open-source-plus-services business, and some
    companies will not use AGPL code at all.
  - Relicensing and contributions: to change the licence later or sell a commercial licence alongside an open one,
    the owner needs rights to all the code. A DCO sign-off only certifies that a contributor may submit code under
    the project's licence; a CLA (or assignment) can grant broader rights. Today every commit has one author, so
    every option is open; deciding before accepting outside contributions keeps it that way. The LGPL component in
    the web image has its own obligations whatever is chosen.
- Contribution policy (DCO, CLA, none); project name (trademark check not possible here); SECURITY.md contact;
  support terms; repository URL; whether the repository has been shared.
- Fate of `docs/build-guide.md` (not present); whether CLAUDE.md and docs/reports ship publicly; commit author
  identities in history.
- Erasure while invoices are open (refused today); retention defaults in ADR 0051; proof-file retention (400 days
  after close); demo scope (the CSV wizard is in `e2e:demo`, not in `pnpm demo`); distributing images (LGPL).
- Every open decision from reports 3-6 is listed in docs/limitations.md.

## 10. Placeholders and TODOs

`TODO(project-name)`, `TODO(licence)`, `TODO(security-contact)`, `TODO(contribution-policy)`, `TODO(repo-url)`,
`TODO(support-hours)`, `TODO(response-targets)`, `TODO(escalation)`, `TODO(on-call)`, `TODO(monitoring-hookup)`,
`TODO(retention-policy)`, `TODO(disclaimer)` (the guide's Section 2.4 text), `TODO(video-url)`.

## 11. Not verified

Real-host deployment; hosted Supabase (extensions, Vault, Auth settings, platform backups); a second machine;
macOS, Linux, WSL2; the clean-clone, release and CI workflows on GitHub; the cold demo time against the 15-minute
gate; live SMTP deliverability, WhatsApp, Stripe, Anthropic, Slack; Dependabot with this pnpm workspace; a
container vulnerability scan; screen-reader testing; the final demo video (a person must watch it); legal review of
anything, including the licence comparison above.
