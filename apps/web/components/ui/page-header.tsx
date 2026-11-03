import { cn } from "cn";

/** Page title (display-lg, the one h1) + one-line description + at most one primary and one secondary action. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="grid min-w-0 gap-1">
        {eyebrow ? <div className="t-caption text-ink-muted">{eyebrow}</div> : null}
        <h1 className="t-display-lg text-ink">{title}</h1>
        {description ? <p className="t-body-md prose-width text-ink-muted">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:max-sm:flex-1">{actions}</div> : null}
    </header>
  );
}

/** Section heading inside a page (h2). */
export function SectionTitle({ children, id, className, action }: { children: React.ReactNode; id?: string; className?: string; action?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <h2 id={id} className="t-heading-md text-ink" tabIndex={id ? -1 : undefined}>
        {children}
      </h2>
      {action}
    </div>
  );
}
