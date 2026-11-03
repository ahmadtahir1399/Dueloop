"use client";

// Form select (§7.2 Select, §7.3): built from the shadcn Select parts in components/ui/select.tsx, so there is one
// select system. The value is posted through a real hidden <input name>, so forms (server actions and GET filters)
// send exactly what a native <select> sent, including "" for "Any" (Radix rejects "" as an item value, so "" maps to
// an internal sentinel and back). Keyboard: Enter/Space/ArrowDown open, typeahead, arrows, Home/End, Esc.
import { useState } from "react";
import { useController, type Control, type FieldValues } from "react-hook-form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FieldSize } from "@/components/ui/field-shell";

export interface Choice {
  value: string;
  label: string;
}

const EMPTY = "__empty__";
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
  size?: FieldSize;
}) {
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const current = value ?? inner;
  // "" is a real option ("Any") when the list has one; otherwise "" means nothing chosen yet, which Radix shows as
  // the placeholder.
  const hasEmpty = options.some((o) => o.value === "");
  const toRadix = (v: string) => (v === "" ? (hasEmpty ? EMPTY : "") : v);
  return (
    <>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <Select
        value={toRadix(current)}
        onValueChange={(v) => {
          const real = fromRadix(v);
          setInner(real);
          onValueChange?.(real);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} size={size} aria-label={ariaLabel} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value || EMPTY} value={toRadix(o.value)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

/** ChoiceSelect bound to React Hook Form through useController (RHF's Controller hook), wired to a <Field>'s id/aria. */
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
