import Link from "next/link";
import { cn } from "cn";

/** KPI tile (§7.2): label, figure in the display face, sub-line; the whole tile links to a filtered list. */
export function KpiTile({ label, value, sub, href, testId, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; testId?: string; className?: string }) {
  const body = (
    <>
      <span className="t-label">{label}</span>
      <span className="t-display-md break-words text-ink">{value}</span>
      {sub ? <span className="t-caption text-ink-muted">{sub}</span> : null}
    </>
  );
  const cls = cn("card-edge grid content-start gap-1.5 rounded-xl border border-line bg-panel p-5", className);
  return href ? (
    <Link href={href} data-testid={testId} className={cn(cls, "transition-colors-fast hover:border-line-strong hover:shadow-elev-1")}>
      {body}
    </Link>
  ) : (
    <div data-testid={testId} className={cls}>
      {body}
    </div>
  );
}
