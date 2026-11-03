"use client";

// The filtered-list pattern (redesign §4.10, §7.2 FilterBar / FilterChip): one ListScope per list page holds the
// navigation transition; the controls inside it change the URL at once (selects, tabs, checkboxes) or after a 300 ms
// pause in typing (search); ListResults keeps the old rows visible, dimmed, with a thin progress bar (MI15) and
// aria-busy while the server renders the new ones. No Apply button anywhere. Without JavaScript the bar is a plain
// GET form with a <noscript> submit button (C-53).
import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, use, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceSelect, type Choice } from "@/components/ui/choice-select";
import { Checkbox } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ALL } from "@/domain/list-params";
import { cn } from "cn";
import { nextQuery, withQuery } from "./query";
import { useListFilters } from "./useListFilters";

type Scope = ReturnType<typeof useListFilters>;
const ListContext = createContext<Scope | null>(null);

function useScope(): Scope {
  const s = use(ListContext);
  if (!s) throw new Error("filter controls must sit inside <ListScope>");
  return s;
}

/**
 * One per list page. `query` is the page's current search string, from the server that parsed it (use
 * `queryOf(searchParams)`), so the URL stays the single source of truth.
 */
export function ListScope({ query, children }: { query: string; children: React.ReactNode }) {
  return <ListContext value={useListFilters(query)}>{children}</ListContext>;
}

/** The results region: old rows stay, dimmed, with an indeterminate bar (MI15) and aria-busy while loading. */
export function ListResults({ children, className }: { children: React.ReactNode; className?: string }) {
  const { isPending } = useScope();
  return (
    <div
      data-testid="list-results"
      data-motion="MI15"
      aria-busy={isPending || undefined}
      data-pending={isPending ? "" : undefined}
      className={cn("relative grid gap-6", className)}
    >
      {isPending ? <div aria-hidden="true" className="list-progress" /> : null}
      <div className="grid gap-6 transition-opacity duration-(--duration-fast) in-data-pending:opacity-60">{children}</div>
    </div>
  );
}

/** The filter row. A GET form so it still works without JavaScript; with JavaScript nothing submits it. */
export function FilterBar({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <form method="get" role="search" aria-label={label} onSubmit={(e) => e.preventDefault()} className={cn("flex flex-wrap items-end gap-3", className)}>
      {children}
      <noscript>
        <Button type="submit" variant="outline">
          Apply filters
        </Button>
      </noscript>
    </form>
  );
}

/** Search: applies 300 ms after the last keystroke, at once on Enter; Escape clears. Follows the URL on Back/Forward. */
export function FilterSearch({ id, name = "q", label, placeholder, maxLength = 60, className }: { id: string; name?: string; label: string; placeholder?: string; maxLength?: number; className?: string }) {
  const { params, setFilter } = useScope();
  const urlValue = params.get(name) ?? "";
  const [value, setValue] = useState(urlValue);
  const [typing, setTyping] = useState(false);
  const [seen, setSeen] = useState(urlValue);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The URL changed from outside (Back/Forward, a chip, Clear filters): show it, unless the person is mid-typing.
  if (urlValue !== seen) {
    setSeen(urlValue);
    if (!typing) setValue(urlValue);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  const apply = (v: string) => {
    clearTimeout(timer.current);
    setTyping(false);
    setFilter(name, v.trim() || undefined);
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <SearchInput
        id={id}
        name={name}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        className={className}
        leading={<Search />}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setValue(v);
          setTyping(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => apply(v), 300);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply(e.currentTarget.value);
          } else if (e.key === "Escape") apply("");
        }}
      />
    </div>
  );
}

/**
 * Select filter: applies on change. Without a `defaultValue` the first option is "Any" with the "all" sentinel
 * (Radix rejects ""); choosing the default removes the param, so the URL stays short.
 */
export function FilterSelect({
  id,
  name,
  label,
  options,
  defaultValue,
  anyLabel = "Any",
  className,
  size,
  inline,
}: {
  id: string;
  name: string;
  label: string;
  options: readonly Choice[];
  defaultValue?: string;
  anyLabel?: string;
  className?: string;
  size?: "sm" | "md";
  inline?: boolean;
}) {
  const { params, setFilter } = useScope();
  const base = defaultValue ?? ALL;
  const all = defaultValue === undefined ? [{ value: ALL, label: anyLabel }, ...options] : options;
  const raw = params.get(name) ?? base;
  const current = all.some((o) => o.value === raw) ? raw : base;
  return (
    <div className={inline ? "flex items-center gap-2" : "grid gap-1.5"}>
      <Label htmlFor={id} className={inline ? "font-normal text-ink-muted" : undefined}>
        {label}
      </Label>
      <ChoiceSelect id={id} name={name} value={current} onValueChange={(v) => setFilter(name, v === base ? undefined : v)} options={all} className={className} size={size} />
    </div>
  );
}

/** Checkbox filter: applies on change. */
export function FilterCheckbox({ name, value = "1", label }: { name: string; value?: string; label: string }) {
  const { params, setFilter } = useScope();
  return <Checkbox name={name} value={value} checked={params.get(name) === value} onChange={(e) => setFilter(name, e.currentTarget.checked ? value : undefined)} label={label} />;
}

/** Status tabs: real links (shareable, open in a new tab), applied in place on a plain click. */
export function FilterTabs({ name, label, tabs }: { name: string; label: string; tabs: { label: string; value?: string }[] }) {
  const { params, pathname, setFilter } = useScope();
  const current = params.get(name) ?? undefined;
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const active = current === t.value;
        return (
          <a
            key={t.label}
            href={withQuery(pathname, nextQuery(params.toString(), { [name]: t.value }))}
            aria-current={active ? "page" : undefined}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              setFilter(name, t.value);
            }}
            className={cn(
              "inline-flex min-h-11 items-center border-b-2 px-3 t-body-sm font-medium whitespace-nowrap transition-colors-fast",
              active ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}

/** Active filters as chips (MI16), each removable, and "Clear filters" while anything is filtered. */
export function FilterChips({ chips, label = "Active filters" }: { chips: { key: string; label: string }[]; label?: string }) {
  const { setFilter, setFilters } = useScope();
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul aria-label={label} className="flex flex-wrap items-center gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {chips.map((c) => (
            <motion.li
              key={c.key}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.22, ease: [0.05, 0.7, 0.1, 1] }}
              data-motion="MI16"
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-transparent bg-brand-soft py-1 pr-1 pl-3 t-body-sm text-brand-soft-ink"
            >
              {c.label}
              <button
                type="button"
                aria-label={`Remove filter: ${c.label}`}
                onClick={() => setFilter(c.key, undefined)}
                className="press relative inline-flex size-7 items-center justify-center rounded-full transition-colors-fast hover:bg-selected after:absolute after:-inset-2"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(Object.fromEntries(chips.map((c) => [c.key, undefined])))}>
        Clear filters
      </Button>
    </div>
  );
}

/** "Clear filters" as a stand-alone action (the filtered empty state). */
export function ClearFiltersButton({ keys }: { keys: string[] }) {
  const { setFilters } = useScope();
  return (
    <Button type="button" variant="outline" onClick={() => setFilters(Object.fromEntries(keys.map((k) => [k, undefined])))}>
      Clear filters
    </Button>
  );
}
