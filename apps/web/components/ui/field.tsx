// Form field wrapper (§7.2 FormField): label above, help under, error message under with an icon (M2).
// The control receives id, aria-describedby (help + error) and aria-invalid through the render prop.
import { CircleAlert } from "lucide-react";
import { cn } from "cn";

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
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="t-body-sm font-semibold text-ink">
        {label}
        {required ? <span className="font-normal text-ink-muted"> (required)</span> : null}
      </label>
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
    <p id={id} className="field-message-enter flex items-start gap-1.5 t-caption text-error-ink">
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

const CONTROL =
  "w-full min-w-0 rounded-sm border border-line-strong bg-panel px-3 t-body-md text-ink transition-colors-fast outline-none hover:border-ink focus-visible:border-brand aria-invalid:border-error-ink read-only:bg-sunken disabled:bg-sunken";

export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(CONTROL, "h-11 appearance-auto pr-2", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(CONTROL, "min-h-24 py-2 [field-sizing:content] max-h-[calc(10lh+1rem)]", className)} dir="auto" {...props} />;
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
export function MoneyInput({ currency, className, ...props }: React.ComponentProps<"input"> & { currency: string }) {
  return (
    <div className="relative">
      <input inputMode="decimal" autoComplete="off" className={cn(CONTROL, "h-11 pr-16 text-right tabular-nums", className)} {...props} />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center t-body-sm text-ink-muted">
        {currency}
      </span>
    </div>
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
