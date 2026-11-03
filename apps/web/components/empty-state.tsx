import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** S31: outline icon (48 px, subtle), title, one sentence, at most one action. */
export function EmptyState({
  title,
  children,
  icon: Icon = Inbox,
  action,
  headingLevel = 2,
}: {
  title: string;
  children?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-line-control px-6 py-10 text-center" data-empty-state>
      <Icon aria-hidden="true" className="size-12 text-ink-subtle" strokeWidth={1.5} />
      <H className="t-heading-md text-ink" tabIndex={-1} data-empty-title>
        {title}
      </H>
      {children ? <div className="t-body-md prose-width text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
