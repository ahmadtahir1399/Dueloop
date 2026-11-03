// One field shell (§7.3 "Our styling") shared by Input, Textarea, the Select and Combobox triggers and the date field,
// so every control looks and behaves the same. Tokens only (D12).
//   default   44 px, radius-sm, 1 px --input border (border-strong: 3:1 edge), surface background, body-md
//   hover     border --color-text (pointer devices only: Tailwind v4 hover)
//   focus     border primary + a 2 px ring 2 px out that fades in (MI5: outline-color transitions)
//   invalid   2 px error edge (inset shadow, so nothing shifts) and the ring turns error on focus
//   read-only sunken background, no hover change; disabled: sunken + muted text
export const FIELD_SHELL = [
  "w-full min-w-0 rounded-sm border border-input bg-panel t-body-md text-ink",
  "outline-2 outline-offset-2 outline-solid outline-transparent",
  "transition-[color,background-color,border-color,outline-color,box-shadow] duration-(--duration-fast) ease-(--ease-standard)",
  "placeholder:text-ink-muted hover:border-ink",
  "focus-visible:border-brand focus-visible:outline-focus",
  "aria-invalid:border-error-ink aria-invalid:shadow-[inset_0_0_0_1px_var(--color-error-text)] aria-invalid:focus-visible:outline-error-ink",
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-muted disabled:hover:border-input",
].join(" ");

/** Text fields only: CSS :read-only also matches every non-editable element (buttons), so triggers must not get it. */
export const FIELD_READONLY = "read-only:bg-sunken read-only:hover:border-input";

/** Heights: md 44 px (forms); sm 36 px for dense desktop filter bars. */
export const FIELD_HEIGHT = { md: "h-11", sm: "h-9" } as const;
export type FieldSize = keyof typeof FIELD_HEIGHT;

/**
 * The 36 px "sm" size still has a 44 px hit area (§7.3, §3.3 minimum target): an invisible pseudo-element that reaches
 * 44 px tall. For buttons (Select/Combobox triggers). Text inputs cannot carry a pseudo-element, so Input wraps an sm
 * field in a 44 px box that focuses it instead (components/ui/input.tsx).
 */
// The inset is measured from the padding box (inside the 1 px border), so it is computed to make exactly 2.75rem.
export const FIELD_HIT_SM = "relative after:absolute after:inset-x-0 after:inset-y-[calc((100%-2.75rem)/2)]";
