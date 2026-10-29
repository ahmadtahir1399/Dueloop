# Public-repository checklist

Before this repository is made public (the owner's decision and action; nothing here makes anything public). Each
item has evidence or says what is missing. Checked on 2026-10-29 at the commit that adds this file.

| | Item | Evidence / status |
|---|---|---|
| [x] | Secret scan of the working tree | `pnpm repo:audit`: no findings (two test fixtures are allowlisted by exact value, with reasons, in `packages/repo-tools/src/secrets.ts`) |
| [x] | Secret scan of the full git history (all refs) | `pnpm repo:audit`: no findings in any commit; the scanner is proven to fire on a planted, deleted fake key in a throwaway repository. Nothing needs rotating |
| [x] | No `.env` files, keys or certificates tracked | `pnpm repo:audit` (env files, `*.pem`) |
| [x] | No binaries or large files | `pnpm repo:audit`: no tracked binary, nothing over 1 MiB |
| [x] | Fixtures and seed hold synthetic data only | `pnpm repo:audit` fixture-PII check: reserved domains and fictional phone ranges only; five sequential placeholder numbers for PK/AE/DE are allowlisted because no reserved range could be cited |
| [ ] | Personal data in git history | Every commit records the author's name and email address. They become public with the repository. History is not rewritten here (rule: no history rewrite); the owner decides whether that is acceptable |
| [ ] | Internal notes | `CLAUDE.md` (instructions for the AI assistant that built this) and `docs/reports/` (per-phase engineering reports) are internal working documents. DECISION for the owner: keep, edit or remove before publishing |
| [x] | The build guide excluded or sanitised | `docs/build-guide.md` is not in this repository at all (DECISION recorded: publish, sanitise or keep private) |
| [ ] | Licence in place | No licence chosen: no LICENSE file, README says TODO(licence). Until chosen, nobody may reuse the code |
| [ ] | SECURITY.md contact set | TODO(security-contact) |
| [ ] | Contribution policy | TODO(contribution-policy) in CONTRIBUTING.md |
| [ ] | Project name | TODO(project-name): "invoice-followup-agent" is a working name; no trademark check |
| [ ] | Repository URL, support terms | TODO(repo-url), TODO(support-hours), TODO(response-targets), TODO(escalation), TODO(on-call), TODO(monitoring-hookup) |
| [x] | Claims audit | `pnpm repo:audit` claims check: no forbidden phrases, no unsourced numbers in README, SECURITY, CHANGELOG or docs/*.md |
| [x] | Documentation checks | `pnpm docs:check`: links resolve, every mentioned script exists, verified commands run in CI, ADR index complete |
| [x] | Data-handling page matches the code | `pnpm egress:check` |
| [x] | Demo works from a clean clone | all 30 `pnpm verify:all` steps passed in a fresh local clone, incl. the demo contract (13/13) and the image smoke (prompt 7 report, section 2). The GitHub clean-clone job has NOT run (nothing pushed) |
| [x] | Limitations page current | docs/limitations.md (2026-10-29) |
| [ ] | A person has watched the demo video | not done: `pnpm demo:record` output is local only and the owner hosts it (TODO(video-url)) |
| [ ] | Nothing tagged, published or made public | true at this commit; keep it so until every unchecked item above is decided |

Placeholders to fill (search the repository for `TODO(`): project-name, licence, security-contact,
contribution-policy, repo-url, support-hours, response-targets, escalation, on-call, monitoring-hookup,
retention-policy, disclaimer, video-url.
