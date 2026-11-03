import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-pulse rounded-md bg-sunken", className)}
      {...props}
    />
  )
}

export { Skeleton }
