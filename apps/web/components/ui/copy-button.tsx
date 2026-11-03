"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** M12: the copy icon becomes a check for 1.5 s; "Copied" is announced politely. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      aria-label={label}
      className="press inline-flex size-9 items-center justify-center rounded-sm text-ink-muted hover:bg-panel hover:text-ink"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(
            () => setState("copied"),
            () => setState("failed"),
          )
          .finally(() => setTimeout(() => setState("idle"), 1500));
      }}
    >
      {state === "copied" ? <Check aria-hidden="true" className="size-4 text-success-ink" /> : <Copy aria-hidden="true" className="size-4" />}
      {state !== "idle" ? (
        <span role="status" className="sr-only">
          {state === "copied" ? "Copied" : "Couldn't copy"}
        </span>
      ) : null}
    </button>
  );
}
