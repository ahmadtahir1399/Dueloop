"use client"

import * as React from "react"
import { cn } from "cn"
import { Select as SelectPrimitive } from "radix-ui"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"
import { FIELD_HEIGHT, FIELD_HIT_SM, FIELD_SHELL, type FieldSize } from "@/components/ui/field-shell"

// shadcn/ui Select (radix-nova, Radix primitives: the library this repo's components.json already uses) restyled to
// Dueloop (§7.3). Trigger = the Input shell; chevron turns 180° while open; content = surface, radius-lg, elev-2,
// max 320 px, at least the trigger's width, fading/zooming from the trigger side (MI8); items 40 px with a
// primary-soft highlight and a check that pops in when selected (MI9). Radix values: `value` / `onValueChange`.
// Radix rejects "" as an item value: use a sentinel such as "all" (§4.10 rule 11).

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "md",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: FieldSize
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      data-motion="MI8"
      className={cn(
        FIELD_SHELL,
        FIELD_HEIGHT[size],
        size === "sm" ? FIELD_HIT_SM : null,
        "group/select flex items-center justify-between gap-2 px-3 text-left whitespace-nowrap select-none data-[state=open]:border-brand data-placeholder:text-ink-muted",
        "*:data-[slot=select-value]:truncate [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon aria-hidden="true" className="size-4 text-ink-muted transition-transform duration-(--duration-fast) ease-(--ease-standard) group-data-[state=open]/select:rotate-180 motion-reduce:transition-none" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "relative z-(--z-dropdown) max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-(--radix-select-trigger-width) origin-(--radix-select-content-transform-origin) overflow-hidden rounded-lg border border-line bg-panel text-ink shadow-elev-2",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:duration-(--duration-fast) data-open:ease-(--ease-enter)",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-(--duration-fast-exit) data-closed:ease-(--ease-exit)",
          "data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
          "motion-reduce:data-open:zoom-in-100 motion-reduce:data-open:slide-in-from-top-0 motion-reduce:data-closed:zoom-out-100",
          className
        )}
        position={position}
        align={align}
        sideOffset={position === "popper" ? sideOffset : undefined}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className="max-h-80 p-1 data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)"
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("t-label px-3 pt-2 pb-1", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      data-motion="MI9"
      className={cn(
        "relative flex min-h-10 w-full cursor-pointer items-center rounded-sm py-2 pr-9 pl-3 t-body-sm text-ink outline-hidden select-none",
        "transition-colors duration-(--duration-instant) data-highlighted:bg-brand-soft data-highlighted:text-brand-soft-ink data-[state=checked]:font-semibold",
        "data-disabled:pointer-events-none data-disabled:text-ink-muted",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-3 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator className="animate-in zoom-in-60 fade-in-0 duration-(--duration-base) ease-(--ease-settle) motion-reduce:animate-none">
          <CheckIcon aria-hidden="true" className="size-4 text-brand" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-line", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn("flex h-7 cursor-default items-center justify-center bg-panel text-ink-muted", className)}
      {...props}
    >
      <ChevronUpIcon aria-hidden="true" className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn("flex h-7 cursor-default items-center justify-center bg-panel text-ink-muted", className)}
      {...props}
    >
      <ChevronDownIcon aria-hidden="true" className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
