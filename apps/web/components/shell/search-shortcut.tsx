"use client";

import { useEffect } from "react";

/** ⌘K / Ctrl K focuses the search field (§8.1: a modifier shortcut, no single-character shortcuts). */
export function SearchShortcut({ inputId }: { inputId: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        const el = document.getElementById(inputId);
        if (el instanceof HTMLInputElement) {
          e.preventDefault();
          el.focus();
          el.select();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inputId]);
  return null;
}
