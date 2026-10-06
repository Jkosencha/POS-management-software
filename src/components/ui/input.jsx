import * as React from "react"
import { cn } from "cn"

function Input({
  className,
  type,
  ...props
}) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-sm border border-line bg-surface px-3 py-1 text-sm text-ink transition-colors outline-none placeholder:text-muted focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
