"use client";

import { Menu, X } from "lucide-react";
import { useRef, useState } from "react";
import { AppNav, type NavLink } from "@/components/app-nav";
import { Wordmark } from "@/components/ui/wordmark";
import type { CounterKey } from "@/lib/nav";

/**
 * Mobile navigation (< 768 px): a left sheet built on the native <dialog> (showModal gives focus trapping, Esc and
 * the inert background for free); focus returns to the menu button on close. The nav mounts only while open.
 */
export function MobileNav({ links, counters, sending }: { links: NavLink[]; counters: Partial<Record<CounterKey, number>>; sending: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => ref.current?.close();
  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
        className="press inline-flex size-11 items-center justify-center rounded-md text-ink hover:bg-sunken md:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>
      <dialog
        ref={ref}
        aria-label="Menu"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === ref.current) close();
        }}
        className="sheet-left on-inverse m-0 h-dvh max-h-dvh w-[min(20rem,86vw)] max-w-none bg-inverse p-0 text-ink-inverse backdrop:bg-scrim"
      >
        {open ? (
          <div className="flex h-full flex-col gap-6 p-4">
            <div className="flex items-center justify-between">
              <Wordmark inverse />
              <button type="button" onClick={close} aria-label="Close menu" className="press inline-flex size-11 items-center justify-center rounded-md hover:bg-inverse-raised">
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <AppNav links={links} counters={counters} variant="full" onNavigate={close} />
            <div className="mt-auto">{sending}</div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
