"use client";

import { useEffect, useId, useState } from "react";
import { Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "cn";

const OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;
type Choice = (typeof OPTIONS)[number]["value"];

const isChoice = (v: string | undefined): v is Choice => OPTIONS.some((o) => o.value === v);
const PILL = { duration: 0.22, ease: [0.2, 0, 0, 1] as const }; // duration-base, ease-standard (§3.7)

/** next-themes knows the stored choice only on the client; theme UI waits for mount (next-themes README). */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Theme control (§3.1.4, §7.2): System / Light / Dark as native radios in a fieldset, styled as a pill group. The
 * change applies on the client at once (next-themes swaps the class on <html>); nothing goes to the server.
 * Until mounted it renders a same-size placeholder so the server HTML never disagrees with the stored choice.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const id = useId();
  const current: Choice = isChoice(theme) ? theme : "system";
  return (
    <fieldset data-motion="MI30" data-testid="theme-toggle" className={cn("min-w-0", className)}>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-1 rounded-full bg-sunken p-1">
        {OPTIONS.map((o) => {
          const checked = mounted && current === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "relative flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2 t-caption font-medium text-ink-muted transition-colors-fast",
                "hover:text-ink has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus has-focus-visible:outline-solid",
              )}
            >
              <input
                type="radio"
                name={`theme-${id}`}
                value={o.value}
                checked={checked}
                disabled={!mounted}
                onChange={() => setTheme(o.value)}
                className="sr-only"
              />
              {checked && <motion.span layoutId={`theme-pill-${id}`} transition={PILL} aria-hidden="true" className="absolute inset-0 rounded-full bg-panel shadow-elev-1" />}
              <o.icon aria-hidden="true" className="relative size-4 shrink-0" />
              {/* Below 360 px only the icons show; the label stays for screen readers. */}
              <span className="relative max-[359px]:sr-only">{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Header theme button (§3.1.4 "Where"): an icon button that opens a popover with the ThemeToggle. Its icon follows
 * the resolved theme and turns 90° with a cross-fade when it changes (MI30). `inverse` = drawn on a dark band.
 */
export function ThemeMenu({ inverse = false, className }: { inverse?: boolean; className?: string }) {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  const Icon = !mounted ? SunMoon : resolvedTheme === "dark" ? Moon : Sun;
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Theme"
        data-testid="theme-menu"
        className={cn(
          "press inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors-fast",
          inverse ? "text-ink-inverse hover:bg-inverse-raised" : "text-ink-muted hover:bg-sunken hover:text-ink",
          className,
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={mounted ? (resolvedTheme ?? "x") : "x"}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={PILL}
            className="flex"
          >
            <Icon aria-hidden="true" className="size-5" />
          </motion.span>
        </AnimatePresence>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Theme" className="w-80 max-w-[calc(100vw-2rem)]">
        <p aria-hidden="true" className="t-label">
          Theme
        </p>
        <ThemeToggle />
      </PopoverContent>
    </Popover>
  );
}
