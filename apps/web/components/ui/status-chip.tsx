// Invoice status (§3.1.5): always an icon AND a word, never colour alone (D13). Values come from core's
// INVOICE_STATUSES; the labels are UI copy only.
import { CalendarCheck, Circle, CircleCheck, CircleMinus, CircleX, Clock, Flag, Hand, type LucideIcon } from "lucide-react";
import type { InvoiceStatus } from "@dueloop/core";
import { cn } from "cn";

export type Tone = "neutral" | "muted" | "warning" | "info" | "error" | "escalated" | "success" | "brand";

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-chip text-chip-ink",
  muted: "bg-chip text-ink-muted",
  warning: "bg-warning-soft text-warning-ink",
  info: "bg-info-soft text-info-ink",
  error: "bg-error-soft text-error-ink",
  escalated: "bg-escalated text-escalated-ink",
  success: "bg-success-soft text-success-ink",
  brand: "bg-brand-soft text-brand-soft-ink",
};

export const STATUS_VISUAL: Record<InvoiceStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  open: { label: "Open", tone: "neutral", icon: Circle },
  overdue: { label: "Overdue", tone: "warning", icon: Clock },
  promised: { label: "Promised", tone: "info", icon: CalendarCheck },
  disputed: { label: "Disputed", tone: "error", icon: Flag },
  escalated: { label: "Needs a person", tone: "escalated", icon: Hand },
  paid: { label: "Paid", tone: "success", icon: CircleCheck },
  written_off: { label: "Written off", tone: "muted", icon: CircleMinus },
  cancelled: { label: "Cancelled", tone: "muted", icon: CircleX },
};

export function Chip({ tone = "neutral", icon: Icon, children, className, size = "md" }: { tone?: Tone; icon?: LucideIcon; children: React.ReactNode; className?: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "chip inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-transparent font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-2 t-caption" : "h-6 px-2.5 t-caption",
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.75} /> : null}
      {children}
    </span>
  );
}

/** Unknown values (a status added to the database later) still render as a readable neutral chip. */
export function StatusChip({ status, size }: { status: string; size?: "sm" | "md" }) {
  const v = STATUS_VISUAL[status as InvoiceStatus];
  if (!v) return <Chip size={size} icon={Circle}>{status.replaceAll("_", " ")}</Chip>;
  return (
    <Chip tone={v.tone} icon={v.icon} size={size}>
      <span data-status={status}>{v.label}</span>
    </Chip>
  );
}
