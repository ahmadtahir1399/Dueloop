# Release process

Nothing has been released. No tag exists and no image or package has been published; those steps are the
owner's, by hand. The release workflow (`.github/workflows/release.yml`) has never run.

## Versioning

Semantic Versioning. The version lives in the root `package.json`; `APP_VERSION` in `packages/ops/src/index.ts`
must equal it (a unit test checks), because services report it in heartbeats. `CHANGELOG.md` follows Keep a
Changelog 1.1.0.

## Steps

1. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` heading; set the version
   in `package.json` and `APP_VERSION`.
2. If a migration was added: `EXPECTED_SCHEMA_VERSION` equals the newest migration (a unit test checks) and the
   upgrade notes say whether a backup and a maintenance window are needed.
3. Locally, from a clean checkout: `pnpm install --frozen-lockfile`, then `pnpm verify:all` (every suite, the image
   smoke, the backup drill and the demo contract; it writes `.reports/verify-all.json`), then `pnpm repo:audit`.
4. Review `docs/limitations.md` and `docs/security-review.md`; nothing open may be described as fixed.
5. The owner tags the commit (`git tag vX.Y.Z`, then pushes the tag). The release workflow re-runs `verify:all`, builds
   the images without pushing them, and keeps the evidence (reports, licence report) as an artifact.
6. Publishing images or packages, and writing release notes on GitHub, are separate manual decisions. Before
   distributing images, settle the licence decision and the LGPL review (docs/limitations.md).

## Migrations

Forward-only. A migration is never edited once committed; a fix is a new migration. Every service refuses to start
on a schema it was not built for (rule 45), which is what makes the next two rules safe.

- Upgrade: back up (docs/runbook.md "Backup"), apply migrations, deploy the matching build.
- Rollback: there are no down migrations. Restore the pre-upgrade backup and deploy the previous build. A database
  newer than the build (or older) stops the services with a message naming both versions.

## Dependency updates

`.github/dependabot.yml` groups minor and patch updates (production and development separately) weekly, and GitHub
Actions and the base image monthly. Each update must pass CI like any change. Base image bumps follow the steps in
the `Dockerfile` header (tag and digest together).
