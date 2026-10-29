**What changes and why**

**How it was verified** (commands run and their result; say NOT VERIFIED for anything not run)

- [ ] `pnpm verify:all` (or the relevant suites) passed
- [ ] No secrets, `.env` files, binaries or real personal data added (`pnpm repo:audit`)
- [ ] Bug fix: a failing test was written first
- [ ] New migration: `EXPECTED_SCHEMA_VERSION` updated; migrations already committed were not edited
- [ ] Docs and ADRs updated where behaviour changed

Outside contributions cannot be accepted until the contribution policy is decided (CONTRIBUTING.md).
