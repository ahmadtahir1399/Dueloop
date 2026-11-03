import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"
import { LoaderCircle } from "lucide-react"

// Buttons (§7.2): one filled primary per view; secondary is outlined; destructive is filled red and only for
// stop/remove actions. md is 44 px; sm is 36 px with its hit area extended to 44 px (::after), desktop-dense only.
const buttonVariants = cva(
  "press group/button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-medium whitespace-nowrap select-none transition-colors-fast disabled:pointer-events-none disabled:bg-sunken disabled:text-ink-muted aria-disabled:cursor-not-allowed aria-disabled:bg-sunken aria-disabled:text-ink-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-brand text-on-brand hover:bg-brand-hover active:bg-brand-active",
        outline: "border-line-control bg-panel text-ink hover:border-line-strong hover:bg-sunken",
        secondary: "border-line-control bg-panel text-ink hover:border-line-strong hover:bg-sunken",
        ghost: "bg-transparent text-link hover:bg-brand-soft",
        destructive: "bg-danger text-on-danger hover:bg-danger-hover",
        accent: "bg-lime text-on-lime hover:brightness-95",
        link: "h-auto px-0 text-link underline underline-offset-4 hover:no-underline",
      },
      size: {
        default: "h-11 px-4 t-body-md",
        sm: "h-9 px-3 t-body-sm after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
        xs: "h-9 px-3 t-body-sm after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
        lg: "h-13 px-6 t-body-lg",
        icon: "size-11",
        "icon-xs": "size-9",
        "icon-sm": "size-9",
        "icon-lg": "size-13",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  loadingLabel = "Saving…",
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Shows a spinner and the verb label; the button keeps its place and blocks a double submit. */
    loading?: boolean
    loadingLabel?: string
  }) {
  const Comp = asChild ? Slot.Root : "button"
  if (asChild) {
    return (
      <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Comp>
    )
  }
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
      disabled={props.disabled || loading}
    >
      {loading ? (
        <>
          <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
