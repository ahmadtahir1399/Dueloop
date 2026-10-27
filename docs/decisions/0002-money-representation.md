# 0002: Money as integer minor units with ISO 4217 exponents

**Context.** Floats lose cents. Assuming two decimals is wrong for JPY (0), KWD/BHD (3) and
CLF (4). The obvious runtime source, `Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits`,
returns CLDR *display* digits, which differ from the ISO 4217 accounting minor unit for some
codes. Node 24 (ICU 78, CLDR 48) reports **PKR 0, IDR 0, HUF 0**, while ISO 4217 says 2. For a
product used in Pakistan, that is a 100x error.

**Decision.** `Money = { minor: safe non-negative integer, currency: ISO 4217 code }`. The
exponent comes from a generated table, `packages/core/src/iso4217.ts`, built by
`packages/core/scripts/gen-iso4217.mjs` from SIX "List One" (via the datasets/currency-codes
mirror, commit recorded in the file header). Codes with no minor unit (XAU, XDR) and withdrawn
codes are excluded. Arithmetic returns result objects: currency mismatch, overflow beyond
`Number.MAX_SAFE_INTEGER` and going below zero are errors, not exceptions. `splitInstalments`
gives each part `floor(total / n)` and hands the remainder, one minor unit each, to the first
parts; it is property-tested to sum exactly. Formatting and parsing are string-based at the edge.

**Consequences.** Money never depends on the host's ICU version. Adding or retiring a currency
means re-running the generator. Locale-aware display (symbols, grouping) is a later edge concern.
