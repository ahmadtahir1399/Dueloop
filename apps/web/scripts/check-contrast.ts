// D1: node apps/web/scripts/check-contrast.ts. Prints every pair of §3.1.3 and exits 1 on any failure, on a
// forbidden pair that would pass, or on a ratio that differs from the number printed in the spec.
import { check, DARK, FORBIDDEN, LIGHT } from "../lib/contrast.ts";

let failures = 0;
for (const [label, rows] of [["Light", check(LIGHT)], ["Dark", check(DARK)], ["Forbidden (must fail)", check(FORBIDDEN, true)]] as const) {
  console.log(`\n${label}`);
  for (const r of rows) {
    const bad = !r.ok || !r.specMatches;
    if (bad) failures++;
    const spec = r.pair.spec === undefined ? "" : ` (spec ${r.pair.spec.toFixed(2)})`;
    console.log(`${bad ? "FAIL" : " ok "}  ${r.ratio.toFixed(2).padStart(5)}:1  need ${r.pair.min}${spec}  ${r.pair.name}`);
  }
}
console.log(failures ? `\n${failures} failure(s)` : "\nAll contrast pairs pass.");
process.exitCode = failures ? 1 : 0;
