"use client";

// Searchable select (§7.2 Combobox: time zones, currencies). shadcn's current Combobox recipe is built on Base UI
// (`shadcn view combobox` lists @base-ui/react), and this repo's shadcn components use Radix; §7.3 says never mix the
// two (CONFLICTS C-40). So this follows the recipe's shape (a trigger that opens a popover with a search box and a
// list) on Radix Popover:
//   trigger   role=combobox (like Radix SelectTrigger), so its name is the field label and its text is the chosen
//             value; Radix adds aria-expanded, aria-controls and aria-haspopup="dialog", which matches the popup
//   popup     Radix Popover content (role=dialog), labelled by the search label
//   search    role=combobox, aria-controls the listbox, aria-activedescendant the highlighted option
//   keys      Enter/Space/ArrowDown open; ArrowUp/Down move; Enter picks; Escape or Tab close, and focus returns to
//             the trigger (Radix Popover); Home/End stay with the text box
// The value posts through a hidden <input name>, like ChoiceSelect.
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useMemo, useState } from "react";
import { useController, type Control, type FieldValues } from "react-hook-form";
import { cn } from "cn";
import { FIELD_HEIGHT, FIELD_HIT_SM, FIELD_SHELL, type FieldSize } from "@/components/ui/field-shell";
import type { Choice } from "@/components/ui/choice-select";

export function Combobox({
  id,
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Choose…",
  searchLabel = "Search",
  className,
  invalid,
  describedBy,
  size = "md",
  ref,
}: {
  id?: string;
  name?: string;
  options: readonly Choice[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  placeholder?: string;
  searchLabel?: string;
  className?: string;
  invalid?: boolean;
  describedBy?: string;
  size?: FieldSize;
  /** The trigger, so React Hook Form can focus it on a validation error. */
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const statusId = useId();
  const selected = options.find((o) => o.value === current);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const optionId = (i: number) => `${listId}-o${i}`;

  const openList = (o: boolean) => {
    setOpen(o);
    if (o) {
      setQuery("");
      const i = Math.max(0, options.findIndex((x) => x.value === current));
      setActive(i);
      requestAnimationFrame(() => document.getElementById(optionId(i))?.scrollIntoView({ block: "nearest" }));
    }
  };
  const pick = (v: string) => {
    setInner(v);
    onValueChange?.(v);
    setOpen(false);
  };
  const move = (i: number) => {
    const n = Math.max(0, Math.min(shown.length - 1, i));
    setActive(n);
    document.getElementById(optionId(n))?.scrollIntoView({ block: "nearest" });
  };

  return (
    <>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <Popover.Root open={open} onOpenChange={openList}>
        <Popover.Trigger
          ref={ref}
          id={id}
          type="button"
          role="combobox"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          data-motion="MI8"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && !open) {
              e.preventDefault();
              openList(true);
            }
          }}
          className={cn(
            FIELD_SHELL,
            FIELD_HEIGHT[size],
            size === "sm" ? FIELD_HIT_SM : null,
            "group/combo flex items-center justify-between gap-2 px-3 text-left data-[state=open]:border-brand",
            className,
          )}
        >
          <span className={cn("min-w-0 truncate", selected ? null : "text-ink-muted")}>{selected?.label ?? placeholder}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-ink-muted transition-transform duration-(--duration-fast) group-data-[state=open]/combo:rotate-180 motion-reduce:transition-none" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={searchLabel}
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>("input")?.focus();
            }}
            className={cn(
              "z-(--z-dropdown) w-(--radix-popover-trigger-width) min-w-64 overflow-hidden rounded-lg border border-line bg-panel text-ink shadow-elev-2",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-(--duration-fast)",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-(--duration-fast-exit)",
              "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 motion-reduce:animate-none",
            )}
          >
            <div className="relative border-b border-line p-1">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-muted" />
              <input
                role="combobox"
                aria-label={searchLabel}
                aria-expanded={shown.length > 0}
                aria-controls={shown.length > 0 ? listId : undefined}
                aria-describedby={shown.length > 0 ? undefined : statusId}
                aria-autocomplete="list"
                aria-activedescendant={shown.length ? optionId(active) : undefined}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") move(active + 1);
                  else if (e.key === "ArrowUp") move(active - 1);
                  else if (e.key === "Enter") {
                    const o = shown[active];
                    if (o) pick(o.value);
                  } else if (e.key === "Tab") setOpen(false);
                  else return;
                  e.preventDefault();
                }}
                autoComplete="off"
                spellCheck={false}
                className="h-10 w-full rounded-sm bg-transparent pr-3 pl-9 t-body-sm text-ink outline-none placeholder:text-ink-muted"
                placeholder={`${searchLabel}…`}
              />
            </div>
            {shown.length === 0 ? (
              <p id={statusId} role="status" className="px-4 py-3 t-body-sm text-ink-muted">
                No matches for &ldquo;{query}&rdquo;
              </p>
            ) : (
              <ul id={listId} role="listbox" aria-label={searchLabel} className="max-h-80 overflow-y-auto p-1">
                {shown.map((o, i) => {
                  const isSel = o.value === current;
                  return (
                    <li
                      key={o.value}
                      id={optionId(i)}
                      role="option"
                      aria-selected={isSel}
                      data-highlighted={i === active ? "" : undefined}
                      data-motion="MI9"
                      onPointerMove={() => setActive(i)}
                      onClick={() => pick(o.value)}
                      className={cn(
                        "relative flex min-h-10 cursor-pointer items-center rounded-sm py-2 pr-9 pl-3 t-body-sm text-ink select-none transition-colors duration-(--duration-instant)",
                        "data-highlighted:bg-brand-soft data-highlighted:text-brand-soft-ink",
                        isSel ? "font-semibold" : null,
                      )}
                    >
                      {o.label}
                      {isSel ? (
                        <Check aria-hidden="true" className="absolute right-3 size-4 text-brand animate-in zoom-in-60 fade-in-0 duration-(--duration-base) ease-(--ease-settle) motion-reduce:animate-none" />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

/** Combobox bound to React Hook Form through useController (RHF's Controller hook), wired to a <Field>'s id/aria. */
export function RhfCombobox({
  control,
  name,
  options,
  field,
  className,
  placeholder,
  searchLabel,
}: {
  control: Control<FieldValues>;
  name: string;
  options: readonly Choice[];
  field: { id: string; "aria-describedby"?: string; "aria-invalid"?: true };
  className?: string;
  placeholder?: string;
  searchLabel?: string;
}) {
  const { field: f } = useController({ control, name });
  return (
    <Combobox
      ref={f.ref}
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
      searchLabel={searchLabel}
    />
  );
}
