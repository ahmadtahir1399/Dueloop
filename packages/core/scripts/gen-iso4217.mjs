import { readFileSync, writeFileSync } from 'node:fs';
const [, , src, out, sha] = process.argv;
const rows = readFileSync(src, 'utf8').trim().split(/\r?\n/).slice(1);
const map = new Map();
for (const line of rows) {
  // Entity may be quoted and contain commas; parse simple CSV.
  const cells = []; let cur = '', q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch; }
  cells.push(cur);
  const [, , code, , minor, withdrawn] = cells;
  if (!code || withdrawn || !/^\d$/.test(minor ?? '')) continue;
  const prev = map.get(code);
  if (prev !== undefined && prev !== Number(minor)) throw new Error('conflict ' + code);
  map.set(code, Number(minor));
}
const entries = [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
const body = entries.map(([c, d]) => `  ${c}: ${d},`).join('\n');
writeFileSync(out, `// GENERATED FILE. Do not edit by hand.
// ISO 4217 minor units for current currencies (SIX "List One").
// Source: github.com/datasets/currency-codes data/codes-all.csv at commit
// ${sha}, a mirror of the SIX Group list. Rows with a withdrawal date or a
// minor unit of "N.A." (e.g. XAU, XDR) are excluded.
// Intl.NumberFormat is NOT used: CLDR display digits differ from ISO 4217
// for some codes (e.g. PKR, IDR, HUF show 0 digits in Node 24 / CLDR 48).

export const ISO4217_MINOR_UNITS: Readonly<Record<string, number>> = {
${body}
};
`);
console.log(entries.length, 'currencies', JSON.stringify(Object.fromEntries(entries.filter(([c]) => ['JPY','USD','KWD','PKR','IDR','HUF','CLF','BHD','INR','GBP','EUR','UYW','ISK'].includes(c)))));
