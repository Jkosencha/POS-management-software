import * as React from "react"
import { cn } from "cn"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"

// Password field with a show / hide toggle. Accepts every Input prop.
function PasswordInput({ className, ...props }) {
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        className="absolute right-1 top-1/2 -translate-y-1/2 grid size-8 place-items-center rounded-full text-muted transition-colors hover:text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export { PasswordInput }
