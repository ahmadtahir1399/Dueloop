import { CircleAlert, CircleCheck, Info, OctagonPause, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "cn";

export type BannerTone = "info" | "warning" | "error" | "success" | "paused";

const STYLE: Record<BannerTone, { cls: string; icon: LucideIcon }> = {
  info: { cls: "border-info-line bg-info-soft text-info-ink", icon: Info },
  warning: { cls: "border-warning-line bg-warning-soft text-warning-ink", icon: TriangleAlert },
  error: { cls: "border-error-line bg-error-soft text-error-ink", icon: CircleAlert },
  success: { cls: "border-success-line bg-success-soft text-success-ink", icon: CircleCheck },
  paused: { cls: "on-inverse border-transparent bg-inverse text-ink-inverse", icon: OctagonPause },
};

/** A region-level message: icon + text + optional action (§7.2 Banner). */
export function Banner({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
  id,
  tabIndex,
  testId,
}: {
  tone?: BannerTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  role?: "status" | "alert";
  id?: string;
  tabIndex?: number;
  testId?: string;
}) {
  const { cls, icon: Icon } = STYLE[tone];
  return (
    <div role={role} id={id} tabIndex={tabIndex} data-tone={tone} data-testid={testId} className={cn("flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 t-body-sm", cls, className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        {title ? <span className="font-semibold">{title} </span> : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
