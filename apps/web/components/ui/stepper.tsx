import { Check } from "lucide-react";
import { cn } from "cn";

/** Stepper (§7.2): done = primary, current = lime ring, todo = stone. Mobile: "Step n of m" + progress bar. */
export function Stepper({ steps, current, label = "Progress" }: { steps: string[]; current: number; label?: string }) {
  return (
    <nav aria-label={label}>
      <p className="t-caption text-ink-muted sm:hidden">
        Step {Math.min(current + 1, steps.length)} of {steps.length}: <span className="font-semibold text-ink">{steps[current]}</span>
      </p>
      <div aria-hidden="true" className="mt-2 h-1.5 rounded-full bg-track sm:hidden">
        <div className="h-1.5 rounded-full bg-brand" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
      </div>
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={s} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full t-caption font-semibold transition-colors-fast",
                  state === "done" && "bg-brand text-on-brand",
                  state === "current" && "bg-panel text-ink ring-2 ring-lime ring-offset-2 ring-offset-canvas",
                  state === "todo" && "bg-sunken text-ink-muted",
                )}
              >
                {state === "done" ? <Check aria-hidden="true" className="size-4" /> : i + 1}
              </span>
              <span className={cn("t-body-sm", state === "todo" ? "text-ink-muted" : "font-semibold text-ink")}>
                {s}
                {state === "done" ? <span className="sr-only"> (done)</span> : null}
              </span>
              {i < steps.length - 1 ? <span aria-hidden="true" className={cn("mx-1 h-px w-8", i < current ? "bg-brand" : "bg-line")} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
