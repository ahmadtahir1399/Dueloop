import { BUCKET_LABEL, BUCKETS, type Bucket } from "@/lib/data/overview";
import { formatMinor } from "@/lib/money";

// Ageing chart without a chart library: server-rendered bars (no JavaScript) plus the same numbers as a table.
// The bars are decorative (aria-hidden); the table is the accessible version and is always shown.
export function AgeingChart({ rows }: { rows: { currency: string; bucket: Bucket; invoices: number; balance: string }[] }) {
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  if (currencies.length === 0) return <p className="text-sm text-muted-foreground">No open invoices.</p>;
  return (
    <div className="grid gap-6">
      {currencies.map((cur) => {
        const byBucket = new Map(rows.filter((r) => r.currency === cur).map((r) => [r.bucket, r]));
        const max = [...byBucket.values()].reduce((m, r) => (BigInt(r.balance) > m ? BigInt(r.balance) : m), 0n);
        return (
          <div key={cur} className="grid gap-3" data-testid={`ageing-${cur}`}>
            <div aria-hidden="true" className="grid gap-1.5">
              {BUCKETS.map((b) => {
                const r = byBucket.get(b);
                const pct = r && max > 0n ? Number((BigInt(r.balance) * 1000n) / max) / 10 : 0;
                return (
                  <div key={b} className="grid grid-cols-[10rem_1fr] items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{BUCKET_LABEL[b]}</span>
                    <span className="h-4 rounded-sm bg-muted">
                      <span className={`block h-4 rounded-sm ${b === "not_due" ? "bg-chart-2" : "bg-destructive"}`} style={{ width: `${pct}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>
            <table className="w-full text-sm">
              <caption className="text-left text-muted-foreground">Open balances by age, {cur}</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-1 font-medium">Age</th>
                  <th scope="col" className="py-1 text-right font-medium">Invoices</th>
                  <th scope="col" className="py-1 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {BUCKETS.map((b) => {
                  const r = byBucket.get(b);
                  return (
                    <tr key={b} className="border-b last:border-0" data-bucket={b}>
                      <th scope="row" className="py-1 text-left font-normal">{BUCKET_LABEL[b]}</th>
                      <td className="py-1 text-right tabular-nums">{r?.invoices ?? 0}</td>
                      <td className="py-1 text-right tabular-nums">{formatMinor(r?.balance ?? "0", cur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
