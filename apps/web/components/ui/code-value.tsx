import { cn } from "cn";
import { CopyButton } from "./copy-button";

/** IDs, keys and references: tabular, sunken, with a copy button. */
export function CodeValue({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-sm bg-sunken py-0.5 pl-2 t-body-sm tabular-nums", className)}>
      <code className="truncate font-mono">{value}</code>
      <CopyButton value={value} label={`Copy ${label}`} />
    </span>
  );
}
