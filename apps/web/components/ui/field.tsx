// Form field wrapper (§7.2 FormField): label above, help under, error message under with an icon (M2).
// The control receives id, aria-describedby (help + error) and aria-invalid through the render prop.
import { CircleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";

export { Textarea } from "@/components/ui/textarea";

export interface ControlAria {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export function Field({
  id,
  label,
  help,
  error,
  required,
  className,
  children,
}: {
  id: string;
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: (aria: ControlAria) => React.ReactNode;
}) {
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-msg` : undefined;
  const describedBy = [helpId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("group/field grid content-start gap-1.5", className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true as const } : {}) })}
      {help ? (
        <p id={helpId} className="t-caption text-ink-muted">
          {help}
        </p>
      ) : null}
      <FieldMessage id={errId} message={error} />
    </div>
  );
}

export function FieldMessage({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} data-motion="MI6" className="field-message-enter flex items-start gap-1.5 t-caption text-error-ink">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      {message}
    </p>
  );
}

/** Group of checkboxes or radios. */
export function Fieldset({ legend, help, error, children, className }: { legend: React.ReactNode; help?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cn("grid gap-2", className)}>
      <legend className="mb-1 t-body-sm font-semibold text-ink">{legend}</legend>
      {help ? <p className="t-caption text-ink-muted">{help}</p> : null}
      {children}
      <FieldMessage message={error} />
    </fieldset>
  );
}

export function Checkbox({ label, className, ...props }: React.ComponentProps<"input"> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-2 t-body-md text-ink", className)}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--color-primary)]" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function Radio({ label, className, ...props }: React.ComponentProps<"input"> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 py-2 t-body-md text-ink", className)}>
      <input type="radio" className="mt-0.5 size-5 shrink-0 accent-[var(--color-primary)]" {...props} />
      <span>{label}</span>
    </label>
  );
}

/** Amount input: tabular, right-aligned, decimal keypad, currency code as a non-editable suffix. */
export function MoneyInput({ currency, className, ...props }: Omit<React.ComponentProps<typeof Input>, "trailing"> & { currency: string }) {
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      className={cn("text-right tabular-nums", className)}
      trailingWidth={3.5}
      trailing={
        <span aria-hidden="true" className="pointer-events-none pr-2 t-body-sm text-ink-muted">
          {currency}
        </span>
      }
      {...props}
    />
  );
}

/** Form-level error banner (§5.7): role=alert, receives focus. */
export function FormError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <div id={id} role="alert" tabIndex={-1} className="field-message-enter flex items-start gap-2 rounded-lg border border-error-line bg-error-soft px-4 py-3 t-body-sm text-error-ink">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function FormSuccess({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="status" className="t-body-sm text-success-ink">
      {message}
    </p>
  );
}
