"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/ui/wordmark";
import { cn } from "cn";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#safety", label: "Safety" },
  { href: "#payments", label: "Payments" },
  { href: "#faq", label: "FAQ" },
];

/**
 * Landing header (§4.9.1, M24): transparent with inverse text over the hero, then a surface with a border once the
 * hero has scrolled past. Links move focus to the section heading. Tablet/mobile: links in a menu sheet.
 */
export function LandingHeader() {
  // "top": transparent over the hero; "hero": scrolled but still over the hero, solid inverse so nothing shows
  // through; "page": past the hero, page surface with a border (M24).
  const [mode, setMode] = useState<"top" | "hero" | "page">("top");
  const solid = mode === "page";
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const onScroll = () => setMode(window.scrollY < 8 ? "top" : window.scrollY < window.innerHeight * 0.45 ? "hero" : "page");
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const go = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const target = document.querySelector<HTMLElement>(href);
    if (!target) return;
    e.preventDefault();
    dialog.current?.close();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    target.focus({ preventScroll: true });
    history.replaceState(null, "", href);
  };
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-(--z-header) transition-colors-fast",
        mode === "page"
          ? "border-b border-line bg-canvas text-ink shadow-elev-1"
          : mode === "hero"
            ? "on-inverse border-b border-inverse-raised bg-inverse text-ink-inverse"
            : "on-inverse border-b border-transparent bg-transparent text-ink-inverse",
      )}
    >
      <div className="mx-auto flex h-14 max-w-(--content-max) items-center gap-4 gutter lg:h-[72px]">
        <Link href="/" aria-label="Dueloop home" className="mr-auto rounded-sm">
          <Wordmark inverse={!solid} />
        </Link>
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="flex gap-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={(e) => go(e, l.href)} className="inline-flex min-h-11 items-center rounded-md px-3 t-body-sm font-medium hover:underline">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <Link href="/sign-in" className="inline-flex min-h-11 items-center rounded-md px-2 t-body-sm font-semibold hover:underline">
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className={cn(
            "press hidden min-h-11 items-center rounded-md px-4 t-body-sm font-semibold sm:inline-flex",
            solid ? "bg-brand text-on-brand hover:bg-brand-hover" : "bg-lime text-on-lime hover:brightness-95",
          )}
        >
          Create account
        </Link>
        <button
          type="button"
          aria-label="Open menu"
          aria-haspopup="dialog"
          onClick={() => dialog.current?.showModal()}
          className="press inline-flex size-11 items-center justify-center rounded-md lg:hidden"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>
      </div>
      <dialog
        ref={dialog}
        aria-label="Menu"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        className="sheet-left m-0 ml-auto h-dvh max-h-dvh w-[min(20rem,86vw)] max-w-none bg-panel p-0 text-ink backdrop:bg-scrim"
      >
        <div className="grid gap-6 p-4">
          <div className="flex items-center justify-between">
            <Wordmark />
            <button type="button" aria-label="Close menu" onClick={() => dialog.current?.close()} className="press inline-flex size-11 items-center justify-center rounded-md hover:bg-sunken">
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <nav aria-label="Sections (menu)">
            <ul className="grid gap-1">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} onClick={(e) => go(e, l.href)} className="flex min-h-11 items-center rounded-md px-3 t-body-md font-medium hover:bg-sunken">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <Link href="/sign-up" className="press inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 font-semibold text-on-brand">
            Create account
          </Link>
        </div>
      </dialog>
    </header>
  );
}
