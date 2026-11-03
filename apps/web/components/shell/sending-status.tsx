import Link from "next/link";

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Bottom of the sidebar (§4.2): always says whether reminders are going out; owners get a link to the switch. */
export function SendingStatus({ paused, canToggle, quietStart, quietEnd }: { paused: boolean; canToggle: boolean; quietStart: number; quietEnd: number }) {
  const text = (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className={paused ? "size-2 rounded-full bg-warning-line" : "size-2 rounded-full bg-lime"} />
      <span>Sending: {paused ? "Paused" : "On"}</span>
    </span>
  );
  return (
    <div className="grid gap-1 border-t border-inverse-raised px-3 pt-3 t-caption text-ink-inverse-muted">
      {canToggle ? (
        <Link href="/settings#sending" className="min-h-9 rounded-sm py-1 text-ink-inverse hover:underline">
          {text}
        </Link>
      ) : (
        <span className="py-1 text-ink-inverse">{text}</span>
      )}
      {quietStart !== quietEnd ? <span>Quiet hours {hh(quietStart)}–{hh(quietEnd)}</span> : null}
    </div>
  );
}
