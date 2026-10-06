import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-accent-tint text-accent-text",
        secondary: "bg-surface-2 text-muted",
        success: "bg-green-tint text-green",
        warning: "bg-amber-tint text-amber-warn",
        destructive: "bg-red-tint text-red",
        solid: "bg-accent text-white",
        outline: "border border-line text-ink-2",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({ className, variant, ...props }) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
