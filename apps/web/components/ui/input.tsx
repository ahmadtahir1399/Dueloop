import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-sm border border-line-strong bg-panel px-3 t-body-md text-ink transition-colors-fast outline-none placeholder:text-ink-muted hover:border-ink focus-visible:border-brand file:mr-3 file:inline-flex file:h-8 file:rounded-xs file:border-0 file:bg-sunken file:px-3 file:t-body-sm file:font-medium file:text-ink disabled:cursor-not-allowed disabled:bg-sunken read-only:bg-sunken aria-invalid:border-error-ink",
        className
      )}
      {...props}
    />
  )
}

export { Input }
