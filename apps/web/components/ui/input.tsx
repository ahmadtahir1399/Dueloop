"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "cn"
import { FIELD_HEIGHT, FIELD_READONLY, FIELD_SHELL, type FieldSize } from "@/components/ui/field-shell"

// shadcn/ui Input restyled to Dueloop (§7.3): the shared field shell, plus an optional leading icon (search) and a
// trailing slot (currency code, clear ×, show-password toggle) drawn inside the field. React 19 passes `ref` as a
// prop, so register() from React Hook Form reaches the <input> through {...props}.
type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: FieldSize
  leading?: React.ReactNode
  trailing?: React.ReactNode
  /** Width of the trailing slot in rem, so text never runs under it. */
  trailingWidth?: number
}

function Input({ className, type, size = "md", leading, trailing, trailingWidth = 3, style, ref, ...props }: InputProps) {
  const own = React.useRef<HTMLInputElement | null>(null)
  const field = (
    <input
      ref={(el) => {
        own.current = el
        if (typeof ref === "function") ref(el)
        else if (ref) ref.current = el
      }}
      type={type}
      data-slot="input"
      data-motion="MI5"
      className={cn(
        FIELD_SHELL,
        FIELD_READONLY,
        FIELD_HEIGHT[size],
        "px-3 file:mr-3 file:inline-flex file:h-8 file:rounded-xs file:border-0 file:bg-sunken file:px-3 file:t-body-sm file:font-medium file:text-ink",
        leading ? "pl-9" : null,
        className
      )}
      style={trailing ? { paddingRight: `${trailingWidth + 0.5}rem`, ...style } : style}
      {...props}
    />
  )
  const group =
    !leading && !trailing ? (
      field
    ) : (
      <div data-slot="input-group" className="relative w-full min-w-0">
        {leading ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted [&_svg]:size-4">
            {leading}
          </span>
        ) : null}
        {field}
        {trailing ? <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span> : null}
      </div>
    )
  if (size !== "sm") return group
  // A 36 px field keeps a 44 px hit area (§7.3): the 4 px band above and below focuses the field.
  return (
    <div
      data-slot="input-hit"
      className="flex min-h-11 w-full min-w-0 cursor-text items-center"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return
        e.preventDefault()
        own.current?.focus()
      }}
    >
      {group}
    </div>
  )
}

/**
 * Search field (§7.2 TextField "search"): leading magnifier, and a clear × that fades and scales in once there is
 * text (MI7). Escape also clears. Uncontrolled by default, so it still posts with a plain GET form.
 */
function SearchInput({ defaultValue, onChange, onKeyDown, hint, ...props }: Omit<InputProps, "type" | "trailing"> & { hint?: React.ReactNode }) {
  const ref = React.useRef<HTMLInputElement | null>(null)
  const [hasText, setHasText] = React.useState(typeof defaultValue === "string" && defaultValue !== "")
  const { ref: outerRef, ...rest } = props
  const setRef = (el: HTMLInputElement | null) => {
    ref.current = el
    if (typeof outerRef === "function") outerRef(el)
    else if (outerRef) outerRef.current = el
  }
  const clear = () => {
    const el = ref.current
    if (!el) return
    // Through the native setter + an input event, so React (and RHF) see the change.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, "")
    el.dispatchEvent(new Event("input", { bubbles: true }))
    setHasText(false)
    el.focus()
  }
  return (
    <Input
      {...rest}
      ref={setRef}
      type="search"
      defaultValue={defaultValue}
      className={cn("[&::-webkit-search-cancel-button]:appearance-none", rest.className)}
      onChange={(e) => {
        setHasText(e.currentTarget.value !== "")
        onChange?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.currentTarget.value !== "") {
          e.preventDefault()
          clear()
        }
        onKeyDown?.(e)
      }}
      trailingWidth={hint ? 4 : 2.75}
      trailing={
        hasText ? (
          <button
            type="button"
            aria-label="Clear search"
            data-motion="MI7"
            onClick={clear}
            className="press inline-flex size-9 items-center justify-center rounded-full text-ink-muted animate-in fade-in-0 zoom-in-75 duration-(--duration-fast) ease-(--ease-enter) hover:bg-sunken hover:text-ink motion-reduce:animate-none"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : hint ? (
          <span aria-hidden="true" className="pointer-events-none pr-1">
            {hint}
          </span>
        ) : null
      }
    />
  )
}

export { Input, SearchInput }
export type { InputProps }
