"use client";

// Custom date field (§7.2 DateField): a typeable YYYY-MM-DD input (works with RHF register and with typing) plus a
// calendar popover. Calendar keyboard: arrows move a day/week, PageUp/PageDown a month, Home/End the week,
// Enter/Space picks, Esc closes and returns focus. Dates are calendar dates (no time zone conversion).
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "radix-ui";
import { forwardRef, useEffect, useRef, useState } from "react";
import { cn } from "cn";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (v: string | undefined) => {
  const m = v ? ISO.exec(v) : null;
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
};
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function shift(iso: string, days: number): string {
  const p = parse(iso);
  if (!p) return iso;
  const t = new Date(Date.UTC(p.y, p.m, p.d + days));
  return toIso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}
function shiftMonth(iso: string, months: number): string {
  const p = parse(iso);
  if (!p) return iso;
  const first = new Date(Date.UTC(p.y, p.m + months, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  return toIso(y, m, Math.min(p.d, daysIn(y, m)));
}
function todayIso(): string {
  const n = new Date();
  return toIso(n.getFullYear(), n.getMonth(), n.getDate());
}

type InputProps = Omit<React.ComponentProps<"input">, "type" | "min" | "max"> & { min?: string | number; max?: string | number; invalid?: boolean };

export const DatePicker = forwardRef<HTMLInputElement, InputProps>(function DatePicker({ className, min: minProp, max: maxProp, invalid, defaultValue, ...props }, ref) {
  const min = minProp === undefined ? undefined : String(minProp);
  const max = maxProp === undefined ? undefined : String(maxProp);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(typeof defaultValue === "string" ? defaultValue : "");
  const [focus, setFocus] = useState(value || max || todayIso());
  const gridRef = useRef<HTMLDivElement>(null);

  // Keep the shown value in sync with what is typed or set by RHF.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const sync = () => setValue(el.value);
    sync();
    el.addEventListener("input", sync);
    return () => el.removeEventListener("input", sync);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>('[data-focus="true"]')?.focus());
  }, [open, focus]);

  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max);
  const pick = (iso: string) => {
    if (!allowed(iso)) return;
    const el = inputRef.current;
    if (el) {
      // Set the value the way a user would, so React Hook Form and React both see the change.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, iso);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setValue(iso);
    setOpen(false);
    requestAnimationFrame(() => el?.focus());
  };

  const f = parse(focus) ?? { y: 2000, m: 0, d: 1 };
  const firstDow = (new Date(Date.UTC(f.y, f.m, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysIn(f.y, f.m) }, (_, i) => toIso(f.y, f.m, i + 1))];
  const today = todayIso();

  const onGridKey = (e: React.KeyboardEvent) => {
    const map: Record<string, () => string> = {
      ArrowLeft: () => shift(focus, -1),
      ArrowRight: () => shift(focus, 1),
      ArrowUp: () => shift(focus, -7),
      ArrowDown: () => shift(focus, 7),
      PageUp: () => shiftMonth(focus, -1),
      PageDown: () => shiftMonth(focus, 1),
      Home: () => shift(focus, -((new Date(`${focus}T00:00:00Z`).getUTCDay() + 6) % 7)),
      End: () => shift(focus, 6 - ((new Date(`${focus}T00:00:00Z`).getUTCDay() + 6) % 7)),
    };
    const go = map[e.key];
    if (go) {
      e.preventDefault();
      setFocus(go());
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setFocus(parse(value) ? value : max && today > max ? max : today);
      }}
    >
      <div className="relative">
        <input
          {...props}
          ref={(el) => {
            inputRef.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
          defaultValue={defaultValue}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="YYYY-MM-DD"
          pattern="\d{4}-\d{2}-\d{2}"
          aria-invalid={invalid || props["aria-invalid"] || undefined}
          className={cn(
            "h-11 w-full min-w-0 rounded-sm border border-line-strong bg-panel pr-12 pl-3 t-body-md text-ink tabular-nums transition-colors-fast outline-none placeholder:text-ink-muted hover:border-ink focus-visible:border-brand aria-invalid:border-error-ink",
            className,
          )}
        />
        <Popover.Trigger
          aria-label="Open calendar"
          className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-sm text-ink-muted hover:bg-sunken hover:text-ink data-[state=open]:text-brand"
        >
          <CalendarDays aria-hidden="true" className="size-4" />
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-(--z-dropdown) w-[19rem] rounded-lg border border-line bg-raised p-3 text-ink shadow-elev-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => setFocus(shiftMonth(focus, -1))} className="press inline-flex size-9 items-center justify-center rounded-sm hover:bg-sunken">
              <ChevronLeft aria-hidden="true" className="size-4" />
            </button>
            <p className="t-body-sm font-semibold" aria-live="polite">
              {MONTHS[f.m]} {f.y}
            </p>
            <button type="button" aria-label="Next month" onClick={() => setFocus(shiftMonth(focus, 1))} className="press inline-flex size-9 items-center justify-center rounded-sm hover:bg-sunken">
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div role="grid" aria-label={`${MONTHS[f.m]} ${f.y}`} ref={gridRef} onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5 text-center">
            {WEEK.map((w) => (
              <span key={w} role="columnheader" className="py-1 t-caption text-ink-muted">
                {w}
              </span>
            ))}
            {cells.map((iso, i) =>
              iso ? (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  tabIndex={iso === focus ? 0 : -1}
                  data-focus={iso === focus}
                  aria-selected={iso === value}
                  aria-current={iso === today ? "date" : undefined}
                  aria-label={`${Number(iso.slice(8))} ${MONTHS[f.m]} ${f.y}`}
                  disabled={!allowed(iso)}
                  onClick={() => pick(iso)}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-sm t-body-sm tabular-nums outline-none transition-colors-fast",
                    "hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:text-ink-subtle disabled:opacity-50 disabled:hover:bg-transparent",
                    iso === today && "font-bold text-brand",
                    iso === value && "bg-brand font-semibold text-on-brand hover:bg-brand-hover",
                  )}
                >
                  {Number(iso.slice(8))}
                </button>
              ) : (
                <span key={`pad-${i}`} />
              ),
            )}
          </div>
          <div className="mt-2 flex justify-between border-t border-line pt-2">
            <button type="button" onClick={() => pick(max && today > max ? max : today)} className="min-h-9 rounded-sm px-2 t-body-sm font-semibold text-link hover:bg-brand-soft">
              Today
            </button>
            <Popover.Close className="min-h-9 rounded-sm px-2 t-body-sm text-ink-muted hover:bg-sunken">Close</Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
});
