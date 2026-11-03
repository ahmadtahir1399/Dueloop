"use client"

import * as React from "react"
import { cn } from "cn"
import { FIELD_READONLY, FIELD_SHELL } from "@/components/ui/field-shell"

// shadcn/ui Textarea (radix-nova, from `shadcn view textarea`) restyled to Dueloop (§7.3): the shared field shell,
// grows with its content up to 10 lines (field-sizing), and shows a character counter when maxLength is set.
// dir="auto" because customers and staff may write right-to-left text. React 19: `ref` arrives as a prop.
function Textarea({ className, maxLength, onChange, ref, ...props }: React.ComponentProps<"textarea">) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null)
  const [count, setCount] = React.useState(() => String(props.value ?? props.defaultValue ?? "").length)
  const counterId = React.useId()
  // The counter follows the field, not only typing: React Hook Form's register()/reset() and a native form reset
  // write the value without a change event. After every render, and after a reset, read the real length.
  React.useEffect(() => {
    const n = inner.current?.value.length ?? 0
    if (n !== count) setCount(n)
  })
  React.useEffect(() => {
    const form = inner.current?.form
    if (!form) return
    const onReset = () => requestAnimationFrame(() => setCount(inner.current?.value.length ?? 0))
    form.addEventListener("reset", onReset)
    return () => form.removeEventListener("reset", onReset)
  }, [])
  const describedBy = [props["aria-describedby"], maxLength ? counterId : undefined].filter(Boolean).join(" ") || undefined
  const field = (
    <textarea
      data-slot="textarea"
      data-motion="MI5"
      dir="auto"
      maxLength={maxLength}
      ref={(el) => {
        inner.current = el
        if (typeof ref === "function") ref(el)
        else if (ref) ref.current = el
      }}
      onChange={(e) => {
        setCount(e.currentTarget.value.length)
        onChange?.(e)
      }}
      className={cn(FIELD_SHELL, FIELD_READONLY, "flex field-sizing-content min-h-24 max-h-[calc(10lh+1rem)] px-3 py-2", className)}
      {...props}
      aria-describedby={describedBy}
    />
  )
  if (!maxLength) return field
  return (
    <div data-slot="textarea-group" className="grid gap-1">
      {field}
      <p id={counterId} className="justify-self-end t-caption text-ink-muted tabular-nums">
        {count} / {maxLength}
      </p>
    </div>
  )
}

export { Textarea }
