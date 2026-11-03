"use client"

import * as React from "react"
import { cn } from "cn"
import { FIELD_READONLY, FIELD_SHELL } from "@/components/ui/field-shell"

// shadcn/ui Textarea (radix-nova, from `shadcn view textarea`) restyled to Dueloop (§7.3): the shared field shell,
// grows with its content up to 10 lines (field-sizing), and shows a character counter when maxLength is set.
// dir="auto" because customers and staff may write right-to-left text. React 19: `ref` arrives as a prop.
function Textarea({ className, maxLength, onChange, ref, ...props }: React.ComponentProps<"textarea">) {
  const inner = React.useRef<HTMLTextAreaElement | null>(null)
  const [count, setCount] = React.useState(0)
  const counterId = React.useId()
  // RHF register() and defaultValue fill the field outside onChange: read the length once mounted.
  React.useEffect(() => {
    if (inner.current) setCount(inner.current.value.length)
  }, [])
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
      aria-describedby={maxLength ? cn(props["aria-describedby"], counterId) : props["aria-describedby"]}
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
