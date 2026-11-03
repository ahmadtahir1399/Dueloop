import { cn } from "cn";

/** The one place the product name is drawn (Q12: typographic; the name is not trademark-checked). */
export const PRODUCT_NAME = "Dueloop";

export function Wordmark({ className, inverse = false, compact }: { className?: string; inverse?: boolean; /** Hide the name visually below this breakpoint (the rail). */ compact?: "below-lg" }) {
  return (
    <span className={cn("t-heading-md inline-flex items-center gap-2 font-display font-bold", inverse ? "text-ink-inverse" : "text-ink", className)}>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5">
        <circle cx="10" cy="11" r="7" fill="none" stroke="var(--color-accent)" strokeWidth="2.5" />
        <path d="M10 1.5v4" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className={compact === "below-lg" ? "max-lg:sr-only" : undefined}>{PRODUCT_NAME}</span>
    </span>
  );
}
