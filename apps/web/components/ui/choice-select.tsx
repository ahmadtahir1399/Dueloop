"use client";

// Custom select (§7.2 Select/Combobox): Radix Select for the listbox (keyboard: arrows, Home/End, typeahead,
// Esc), styled with tokens. The value is posted through a real hidden <input name>, so forms (server actions and
// GET filters) send exactly what a native <select> sent, including "" for "Any".
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select as S } from "radix-ui";
import { useState } from "react";
import { useController, type Control, type FieldValues } from "react-hook-form";
import { cn } from "cn";

export interface Choice {
  value: string;
  label: string;
}

const EMPTY = "__empty__";
const toRadix = (v: string) => (v === "" ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? "" : v);

export function ChoiceSelect({
  id,
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Choose…",
  className,
  invalid,
  describedBy,
  ariaLabel,
  disabled,
  size = "md",
}: {
  id?: string;
  name?: string;
  options: readonly Choice[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  ariaLabel?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? inner;
  return (
    <>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <S.Root
        value={toRadix(current)}
        onValueChange={(v) => {
          const real = fromRadix(v);
          setInner(real);
          onValueChange?.(real);
        }}
        disabled={disabled}
      >
        <S.Trigger
          id={id}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            "group flex w-full min-w-0 items-center justify-between gap-2 rounded-sm border border-line-strong bg-panel px-3 text-left t-body-md text-ink transition-colors-fast outline-none",
            "hover:border-ink focus-visible:border-brand data-[state=open]:border-brand aria-invalid:border-error-ink disabled:cursor-not-allowed disabled:bg-sunken",
            size === "sm" ? "h-10" : "h-11",
            className,
          )}
        >
          <span className="truncate">
            <S.Value placeholder={placeholder} />
          </span>
          <S.Icon asChild>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted transition-transform duration-(--duration-fast) group-data-[state=open]:rotate-180" />
          </S.Icon>
        </S.Trigger>
        <S.Portal>
          <S.Content
            position="popper"
            sideOffset={6}
            className={cn(
              "z-(--z-dropdown) max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-line bg-raised text-ink shadow-elev-2",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none",
            )}
          >
            <S.ScrollUpButton className="flex h-7 items-center justify-center text-ink-muted">
              <ChevronUp aria-hidden="true" className="size-4" />
            </S.ScrollUpButton>
            <S.Viewport className="max-h-80 p-1">
              {options.map((o) => (
                <S.Item
                  key={o.value || EMPTY}
                  value={toRadix(o.value)}
                  className={cn(
                    "relative flex min-h-10 cursor-pointer items-center rounded-sm py-2 pr-9 pl-3 t-body-sm text-ink outline-none select-none",
                    "data-[highlighted]:bg-brand-soft data-[highlighted]:text-brand-soft-ink data-[state=checked]:font-semibold data-[disabled]:opacity-50",
                  )}
                >
                  <S.ItemText>{o.label}</S.ItemText>
                  <S.ItemIndicator className="absolute right-3 inline-flex items-center">
                    <Check aria-hidden="true" className="size-4 text-brand" />
                  </S.ItemIndicator>
                </S.Item>
              ))}
            </S.Viewport>
            <S.ScrollDownButton className="flex h-7 items-center justify-center text-ink-muted">
              <ChevronDown aria-hidden="true" className="size-4" />
            </S.ScrollDownButton>
          </S.Content>
        </S.Portal>
      </S.Root>
    </>
  );
}

/** ChoiceSelect bound to React Hook Form (value + validation), wired to a <Field>'s id/aria. */
export function RhfSelect({
  control,
  name,
  options,
  field,
  className,
  placeholder,
}: {
  control: Control<FieldValues>;
  name: string;
  options: readonly Choice[];
  field: { id: string; "aria-describedby"?: string; "aria-invalid"?: true };
  className?: string;
  placeholder?: string;
}) {
  const { field: f } = useController({ control, name });
  return (
    <ChoiceSelect
      id={field.id}
      name={name}
      options={options}
      value={typeof f.value === "string" ? f.value : String(f.value ?? "")}
      onValueChange={(v) => {
        f.onChange(v);
        f.onBlur();
      }}
      describedBy={field["aria-describedby"]}
      invalid={field["aria-invalid"]}
      className={className}
      placeholder={placeholder}
    />
  );
}
