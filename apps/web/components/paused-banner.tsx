/** Shown whenever the tenant OR the global kill switch is on. Nothing is sent while it is. */
export function PausedBanner({ tenantPaused, globalPaused }: { tenantPaused: boolean; globalPaused: boolean }) {
  if (!tenantPaused && !globalPaused) return null;
  const text = globalPaused
    ? "Sending is paused for everyone by the operator. No reminders or receipts go out until it is resumed."
    : "Sending is paused for this business. No reminders or receipts go out until an owner resumes it.";
  return (
    <div role="status" data-testid="paused-banner" className="border-b border-warning bg-warning/20 text-warning-foreground dark:text-foreground">
      <p className="mx-auto max-w-6xl px-4 py-2 text-sm font-medium">{text}</p>
    </div>
  );
}
