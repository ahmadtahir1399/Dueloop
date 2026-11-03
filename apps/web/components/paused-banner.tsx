import Link from "next/link";
import { Banner } from "@/components/ui/banner";

/** Shown whenever the tenant OR the global kill switch is on. Nothing is sent while it is. */
export function PausedBanner({ tenantPaused, globalPaused, canToggle = false }: { tenantPaused: boolean; globalPaused: boolean; canToggle?: boolean }) {
  if (!tenantPaused && !globalPaused) return null;
  const text = globalPaused
    ? "Sending is paused for everyone by the operator. No reminders or receipts go out until it is resumed."
    : "Sending is paused for this business. No reminders or receipts go out until an owner resumes it.";
  return (
    <div className="mx-auto w-full max-w-(--content-max) gutter pt-4">
      <Banner
        tone="paused"
        role="status"
        testId="paused-banner"
        action={
          !globalPaused && canToggle ? (
            <Link href="/settings#sending" className="inline-flex min-h-9 items-center rounded-sm px-2 font-semibold text-ink-inverse underline">
              Turn sending back on
            </Link>
          ) : undefined
        }
      >
        {text}
      </Banner>
    </div>
  );
}
