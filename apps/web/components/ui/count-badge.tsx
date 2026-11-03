import { cn } from "cn";

/** Waiting-work count (lime + ink, §7.2). Hidden at 0. The accessible name comes from the parent link's label. */
export function CountBadge({ count, className, dot = false }: { count: number | undefined; className?: string; dot?: boolean }) {
  if (!count) return null;
  if (dot) return <span aria-hidden="true" className={cn("inline-block size-2 rounded-full bg-lime", className)} />;
  return (
    <span aria-hidden="true" className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-lime px-1.5 t-caption font-semibold text-on-lime tabular-nums", className)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
