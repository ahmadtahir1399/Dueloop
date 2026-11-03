"use client"

import * as React from "react"
import { cn } from "cn"
import { Label as LabelPrimitive } from "radix-ui"

// shadcn/ui Label restyled to Dueloop (§7.3): body-sm, weight 600, sits 6 px above its field (the Field wrapper's
// gap). A required field says "(required)" in words, never only an asterisk. Inside a Field (`group/field`) the label
// turns primary while its control has focus (MI5).
function Label({
  className,
  required,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "t-body-sm font-semibold text-ink transition-colors duration-(--duration-fast) select-none group-focus-within/field:text-brand peer-disabled:cursor-not-allowed",
        className
      )}
      {...props}
    >
      {children}
      {required ? <span className="font-normal text-ink-muted"> (required)</span> : null}
    </LabelPrimitive.Root>
  )
}

export { Label }
