import { BUCKET_LABEL, BUCKETS, type Bucket } from "@/lib/data/overview";
import { formatMinor } from "@/lib/money";
import { cn } from "cn";

// "Where money is stuck" (§4.4 S05): one real table per currency. The bars are decorative (aria-hidden) and use the
// chart colours, never red (§2.3: overdue is a fact, not an alarm); the figures carry the meaning.
export function AgeingChart({ rows, inverse = false }: { rows: { currency: string; bucket: Bucket; invoices: number; balance: string }[]; inverse?: boolean }) {
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  if (currencies.length === 0) return <p className={cn("t-body-sm", inverse ? "text-ink-inverse-muted" : "text-ink-muted")}>No open invoices.</p>;
  return (
    <div className="grid gap-6">
      {currencies.map((cur) => {
        const byBucket = new Map(rows.filter((r) => r.currency === cur).map((r) => [r.bucket, r]));
        const max = [...byBucket.values()].reduce((m, r) => (BigInt(r.balance) > m ? BigInt(r.balance) : m), 0n);
        return (
          <table key={cur} className="w-full t-body-sm" data-testid={`ageing-${cur}`}>
            <caption className={cn("mb-2 text-left t-caption", inverse ? "text-ink-inverse-muted" : "text-ink-muted")}>Open balances by age, {cur}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Age</th>
                <th scope="col">Invoices</th>
                <th scope="col">Balance</th>
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map((b) => {
                const r = byBucket.get(b);
                const pct = r && max > 0n ? Number((BigInt(r.balance) * 1000n) / max) / 10 : 0;
                return (
                  <tr key={b} data-bucket={b} className="align-bottom">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      <span className="block">{BUCKET_LABEL[b]}</span>
                      <span aria-hidden="true" className={cn("mt-1 block h-1.5 rounded-full", inverse ? "bg-inverse-raised" : "bg-track")}>
                        <span className={cn("block h-1.5 rounded-full", b === "not_due" ? "bg-chart-2" : inverse ? "bg-lime" : "bg-chart-1")} style={{ width: `${pct}%` }} />
                      </span>
                    </th>
                    <td className={cn("py-1.5 pr-3 text-right tabular-nums", inverse ? "text-ink-inverse-muted" : "text-ink-muted")}>{r?.invoices ?? 0}</td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{formatMinor(r?.balance ?? "0", cur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}
